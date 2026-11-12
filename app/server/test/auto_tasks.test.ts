import { beforeAll, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTaskTitle } from '../../shared/auto-task'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'gate-auto-test-'))
process.env.API_TOKEN = 'auto-test-token'
process.env.FAKE_TODAY = '2026-10-07'
const { db } = await import('../db')
const { config } = await import('../config')
const { buildApp } = await import('../app')
const { runSeed } = await import('../../seed/load')
const { autoReason, effectiveMinutes, sweepAutoTasks } = await import('../modules/planner/auto')
const { now, uuid } = await import('../util')
const app = buildApp()
const day = '2026-10-07'
const call = async (method: string, path: string, body?: any) => {
  const res = await app.fetch(new Request('http://x/api' + path, { method,
    headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }))
  return { status: res.status, body: res.status === 204 ? null : await res.json() as any }
}
const task = (title: string, type = 'study', topic_id: string | null = 'prob.bayes', est_minutes = 2, when = day) => {
  const id = uuid()
  db.run(`INSERT INTO plan_tasks(id,date,title,type,topic_id,est_minutes,status,updated_at) VALUES (?,?,?,?,?,?,'todo',?)`, [id, when, title, type, topic_id, est_minutes, now()])
  return id
}
beforeAll(() => runSeed())

test('seed title parsing finds counts, ranges, special routes and missing topics', () => {
  expect(parseTaskTitle('GA practice: verbal aptitude (10 Qs)', 'study')).toMatchObject({ kind: 'questions', count: 10, topic_id: 'ga.verbal' })
  expect(parseTaskTitle('PYQs: Counting: permutations and combinations (8-10 Qs)', 'pyq')).toMatchObject({ kind: 'pyq', count: 8, topic_id: 'prob.counting' })
  expect(parseTaskTitle('Python refresh: lists, dicts, loops (30 easy problems)', 'study')).toMatchObject({ topic_id: 'ds.python', count: 30, kind: 'questions' })
  expect(parseTaskTitle('C refresh: pointers (10 snippets)', 'study').topic_id).toBe('ds.c')
  expect(parseTaskTitle('GA diagnostic set (30+ Qs)', 'mock').count).toBe(30)
  expect(parseTaskTitle('Flashcards: review 12 cards', 'revision').kind).toBe('flashcards')
  expect(parseTaskTitle('Gym', 'gym').kind).toBe('gym')
})

test('a seeded 30-question test preset is accepted', async () => {
  const result = await call('POST', '/tests', { kind: 'quick', scope: { subject: 'ga', easy_to_hard: true, task_preset: true }, count: 30 })
  expect(result.status).toBe(201)
  expect(result.body.questions.length).toBeGreaterThan(0)
  expect(result.body.questions.every((q: any, i: number, all: any[]) => i === 0 || all[i - 1].difficulty <= q.difficulty)).toBe(true)
})

test('active-time batches are idempotent, counted by chapter and auto-complete study', async () => {
  const id = task('Study: Bayes theorem', 'study', 'prob.bayes', 2)
  const batch = { id: uuid(), date: day, kind: 'study', topic_id: 'prob.bayes', seconds: 60 }
  expect((await call('POST', '/plan/active-time', batch)).status).toBe(200)
  expect((await call('POST', '/plan/active-time', batch)).body.duplicate).toBe(true)
  expect(effectiveMinutes(day, 'prob')).toBeGreaterThanOrEqual(1)
  expect((await call('POST', '/plan/active-time', { ...batch, id: uuid() })).status).toBe(200)
  expect((db.query('SELECT status,auto_done,auto_reason FROM plan_tasks WHERE id=?').get(id) as any)).toMatchObject({ status: 'done', auto_done: 1, auto_reason: '2/2 active minutes' })
  expect((await call('PATCH', `/plan/tasks/${id}`, { status: 'todo', done_minutes: 0 })).body.auto_undone_at).toBeTruthy()
  sweepAutoTasks(day)
  expect((db.query('SELECT status,auto_done FROM plan_tasks WHERE id=?').get(id) as any)).toMatchObject({ status: 'todo', auto_done: 0 })
})

test('short active-time batches combine before rounding to a whole minute', async () => {
  const date = '2026-10-08', first = { id: uuid(), date, kind: 'study', topic_id: 'prob.bayes', seconds: 30 }
  await call('POST', '/plan/active-time', first)
  expect((db.query("SELECT minutes FROM study_minutes WHERE date=? AND subject_id='prob' AND source='auto'").get(date) as any)?.minutes).toBeUndefined()
  await call('POST', '/plan/active-time', { ...first, id: uuid() })
  expect((db.query("SELECT minutes FROM study_minutes WHERE date=? AND subject_id='prob' AND source='auto'").get(date) as any)?.minutes).toBe(1)
  await call('POST', '/plan/active-time', first)
  expect((db.query("SELECT minutes FROM study_minutes WHERE date=? AND subject_id='prob' AND source='auto'").get(date) as any)?.minutes).toBe(1)
})

test('question and past-paper rules use attempts in the matching chapter on that day', () => {
  const q = db.query("SELECT id,topic_id FROM questions WHERE source='official' LIMIT 1").get() as any
  expect(q?.id).toBeTruthy()
  const id = task('PYQs: one past paper (1 Q)', 'pyq', q.topic_id)
  expect(autoReason(db.query('SELECT * FROM plan_tasks WHERE id=?').get(id))).toBeNull()
  db.run("INSERT INTO attempts(id,question_id,at,given_answer,correct,updated_at) VALUES (?,?,?,'A',1,?)", [uuid(), q.id, '2026-10-07T08:00:00.000Z', now()])
  expect(autoReason(db.query('SELECT * FROM plan_tasks WHERE id=?').get(id))).toContain('past-paper')
  sweepAutoTasks(day)
  expect((db.query('SELECT auto_done FROM plan_tasks WHERE id=?').get(id) as any).auto_done).toBe(1)
  const practice = task('GA practice: 1 Q', 'study', q.topic_id)
  expect(autoReason(db.query('SELECT * FROM plan_tasks WHERE id=?').get(practice))).toContain('1/1')
})

test('a delayed attempt checks the day recorded in its timestamp', async () => {
  const q = db.query("SELECT id,topic_id FROM questions WHERE source='official' LIMIT 1").get() as any
  const id = task('PYQs: 1 Q', 'pyq', q.topic_id, 2, '2026-10-08')
  const result = await call('POST', '/attempts', { id: uuid(), question_id: q.id, given_answer: 'A', at: '2026-10-08T08:00:00.000Z' })
  expect(result.status).toBe(201)
  expect((db.query('SELECT auto_done FROM plan_tasks WHERE id=?').get(id) as any).auto_done).toBe(1)
})

test('Got it and card reviews can complete their corresponding tasks', async () => {
  const topic = 'prob.bayes'
  db.run("INSERT OR REPLACE INTO topic_notes(topic_id,atoms,updated_at) VALUES (?,?,?)", [topic, JSON.stringify([{ id: 'atom1', name: 'One' }, { id: 'atom2', name: 'Two' }]), now()])
  const study = task('Study: Bayes concepts', 'study', topic, 500)
  db.run("INSERT INTO concept_progress(topic_id,atom_id,status,updated_at) VALUES (?,?,'got_it',?)", [topic, 'atom1', now()])
  expect(autoReason(db.query('SELECT * FROM plan_tasks WHERE id=?').get(study))).toBeNull()
  db.run("INSERT INTO concept_progress(topic_id,atom_id,status,updated_at) VALUES (?,?,'got_it',?)", [topic, 'atom2', now()])
  expect(autoReason(db.query('SELECT * FROM plan_tasks WHERE id=?').get(study))).toContain('Got it')
  const card = task('Flashcards: 2 reviews', 'revision', null, 2, '2026-10-08')
  const id = uuid()
  db.run("INSERT INTO cards(id,kind,front,back,due_on,created_at,updated_at) VALUES (?,'qa','front','back',?,?,?)", [id, '2027-03-01', now(), now()])
  for (let i = 0; i < 2; i++) db.run('INSERT INTO card_reviews(id,card_id,at,grade,updated_at) VALUES (?,?,?,?,?)', [uuid(), id, '2026-10-08T08:00:00.000Z', 4, now()])
  expect(autoReason(db.query('SELECT * FROM plan_tasks WHERE id=?').get(card))).toContain('2/2 cards')
  expect((await call('POST', `/cards/${id}/review`, { grade: 4, at: '2026-10-08T08:01:00.000Z' })).status).toBe(200)
  expect((db.query('SELECT auto_done FROM plan_tasks WHERE id=?').get(card) as any).auto_done).toBe(1)
})

test('job timer or editable activity targets complete job tasks; gym never does', async () => {
  const job = task('Job hunt: applications and outreach', 'job', null, 1)
  const gym = task('Gym', 'gym', null, 0)
  expect((await call('POST', '/plan/active-time', { id: uuid(), date: day, kind: 'job', seconds: 60 })).status).toBe(200)
  expect((db.query('SELECT auto_done FROM plan_tasks WHERE id=?').get(job) as any).auto_done).toBe(1)
  expect((db.query('SELECT auto_done FROM plan_tasks WHERE id=?').get(gym) as any).auto_done).toBe(0)
  expect((await call('GET', '/jobs/today')).body.minutes).toBeGreaterThanOrEqual(1)
  const target = task('Job hunt: applications and outreach', 'job', null, 120)
  await call('PUT', `/checkins/${day}`, { job_applications: 2, referrals_sent: 2, gym_done: true })
  expect((db.query('SELECT auto_reason FROM plan_tasks WHERE id=?').get(target) as any).auto_reason).toContain('applications')
})

test('manual edit overrides auto, which overrides attempts and task estimates without summing', async () => {
  const d = '2026-09-30', sid = 'general', stamp = now()
  for (const [source, minutes] of [['task', 90], ['attempts', 40], ['auto', 25], ['manual', 30]] as const)
    db.run('INSERT INTO study_minutes(date,subject_id,minutes,source,updated_at) VALUES (?,?,?,?,?)', [d, sid, minutes, source, stamp])
  expect(effectiveMinutes(d, sid)).toBe(30)
  expect((await call('GET', `/checkins/${d}`)).body.study_minutes_total).toBe(30)
  db.run("DELETE FROM study_minutes WHERE date=? AND subject_id=? AND source='manual'", [d, sid])
  expect(effectiveMinutes(d, sid)).toBe(25)
  db.run("DELETE FROM study_minutes WHERE date=? AND subject_id=? AND source='auto'", [d, sid])
  expect(effectiveMinutes(d, sid)).toBe(40)
  db.run("DELETE FROM study_minutes WHERE date=? AND subject_id=? AND source='attempts'", [d, sid])
  expect(effectiveMinutes(d, sid)).toBe(90)
})
