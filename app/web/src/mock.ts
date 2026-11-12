// VITE_MOCK=1 only: in-memory fake backend built from app/seed/plan.json and app/data/questions/*.json.
import plan from '../../profiles/owner/plan.json'
import topicsSeed from '../../seed/topics.json'
import { addDays, uuid7 } from './util'

const files = import.meta.glob('../../data/questions/20*.json') as Record<string, () => Promise<{ default: any[] }>>
const ladders = import.meta.glob('../../data/ladders/*.json') as Record<string, () => Promise<{ default: any }>>
const explainers = import.meta.glob('../../data/explainers/*.json') as Record<string, () => Promise<{ default: any }>>
const conceptProgress = new Map<string, string>()
const contentFile = async (files: Record<string, () => Promise<{ default: any }>>, dir: string, id: string) => (await files[`../../data/${dir}/${id}.json`]?.())?.default ?? null
const REAL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const TODAY = REAL < '2026-10-07' ? '2026-10-07' : REAL > '2027-02-06' ? '2026-11-02' : REAL
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const settings: Record<string, any> = { exam_date: '2027-02-06', gym_start: '17:00', gym_end: '19:00', weekday_study_minutes: 390, weekend_study_minutes: 300 }
const topics: any[] = (topicsSeed as any[]).map((t, i) => ({ id: t.id, name: t.name, parent_id: t.parent_id, scope: String(t.paper).toLowerCase(), sort: i, videos: t.videos ?? [] }))
const phases = (plan as any).phases.map((p: any) => ({ id: p.id, name: p.name, start_date: p.start, end_date: p.end, description: p.description }))
const weeks = (plan as any).weeks.map((w: any) => ({ id: 'w' + w.week_no, week_no: w.week_no, phase_id: w.phase_id, start_date: w.start, end_date: w.end, title: w.label,
  macro_goals: w.macro_goals.map((g: any, i: number) => ({ id: `g${w.week_no}-${i}`, text: g.text, metric: g.metric, target: g.target, current: Math.min(g.target, w.week_no < 2 ? Math.floor(g.target * 0.6) : 0), done: false })) }))
let tid = 0
const days: any[] = (plan as any).days.map((d: any) => ({ date: d.date, available_minutes: null, day_kind: 'normal',
  tasks: d.tasks.map((t: any, i: number) => ({ id: 't' + ++tid, date: d.date, sort: i, title: t.title, type: t.type, subject_id: t.subject, topic_id: t.topic_id, est_minutes: t.minutes, priority: t.priority,
    fixed: t.type === 'gym' || t.type === 'job' ? 1 : 0, time_block: t.time_block ?? null, status: 'todo', done_minutes: 0, carry_count: 0 })) }))
// make today look lived-in
const td = days.find((d) => d.date === TODAY)
if (td && td.tasks[1]) { td.tasks[1].carried_over_from = 'x'; td.tasks[1].carry_count = 2 }

let questions: any[] | null = null
async function loadQs() {
  if (questions) return questions
  const all: any[] = []
  for (const f of Object.values(files)) all.push(...(await f()).default)
  const tp = (paper: string, sec: string) => {
    if (sec === 'GA') return topics.filter((t) => t.scope === 'ga')
    const pool = topics.filter((t) => t.parent_id && (t.scope === paper.toLowerCase() || t.scope === 'shared'))
    return pool.length ? pool : topics
  }
  questions = all.map((q, i) => {
    const pool = tp(q.paper, q.section), h = hash(q.id)
    const o: any = { ...q, topic_id: pool[h % pool.length].id, difficulty: 1 + (h % 5), source: 'official', year: q.exam_year }
    if (i % 3 === 0 && !q.needs_review) {
      o.quick_method = 'Eliminate options using the **boundary case** first.\n\n1. Substitute $x = 0$\n2. Compare with the remaining options'
      o.explanation = 'Key idea: $P(A\\mid B) = \\dfrac{P(A\\cap B)}{P(B)}$. Always write the sample space before counting.'
      o.trap_note = 'Do not forget that the events are **not** independent here.'
      o.video_url = 'https://www.youtube.com/watch?v=HZGCoVF3YvM'; o.video_start_s = 90
    }
    return o
  })
  return questions
}
const attempts: any[] = []
const mistakes: any[] = []
const mocks: any[] = [{ id: 'm1', date: '2026-10-01', paper: 'CS', year: 2024, session: 'S1', label: 'CS 2024 S1', raw_score: 38, max_score: 100, accuracy_percent: 61, time_issue: 'ran out' },
  { id: 'm2', date: '2026-10-04', paper: 'DA', year: 2024, session: '', label: 'DA 2024', raw_score: 46, max_score: 100, accuracy_percent: 68 }]
const jobs: any[] = [{ id: 'j1', company: 'Acme Corp', role: 'Backend Engineer', date_applied: '2026-10-02', response: 'ack', next_follow_up: '2026-10-05' },
  { id: 'j2', company: 'Globex', role: 'ML Engineer', date_applied: '2026-10-04', response: 'none', next_follow_up: '2026-10-12' }]
const checkins: any[] = []
const cards: any[] = [
  ['Bayes rule', '$P(A\\mid B)=\\frac{P(B\\mid A)P(A)}{P(B)}$'], ['Variance', '$E[X^2]-(E[X])^2$'], ['Binomial mean', '$np$'], ['Binomial variance', '$np(1-p)$'],
  ['Poisson mean', '$\\lambda$'], ['Rank-nullity', '$\\text{rank}+\\text{nullity}=n$'], ['Trace', 'Sum of eigenvalues'], ['Determinant', 'Product of eigenvalues'],
  ['Master thm, a=2,b=2,f=n', '$\\Theta(n\\log n)$'], ['BFS time', '$O(V+E)$'],
].map(([front, back], i) => ({ id: 'c' + i, topic_id: i < 5 ? 'prob' : i < 8 ? 'la' : 'algo', kind: 'pair', front, back, ease: 2.5, interval_d: 0, reps: 0, due_on: TODAY }))
cards.push({ id: 'c99', topic_id: 'prob', kind: 'qa', front: 'What is the **union bound**?', back: '$P(\\cup A_i)\\le\\sum P(A_i)$', ease: 2.5, interval_d: 6, reps: 2, due_on: TODAY })

const ok = (x: any = null) => x
export async function handle(method: string, rawPath: string, body: any): Promise<any> {
  await sleep(25)
  const [path, qs = ''] = rawPath.split('?'); const q = new URLSearchParams(qs)
  const m = (re: RegExp) => path.match(re)
  let r: RegExpMatchArray | null
  if (path === '/auth/login' || path === '/auth/logout') return null
  if (path === '/modules') return { items: ['planner','practice','learn','review','mocks','habits','jobs'].map(id => ({ id, available: true, enabled: true })) }
  if (path === '/onboarding/status') return { needs_setup: false }
  if (path === '/me') return { actor: 'user', today: TODAY, server_time: new Date().toISOString() }
  if (path === '/settings') { if (method === 'PATCH') Object.assign(settings, body); return settings }
  if (path === '/plan/today') {
    const day = days.find((d) => d.date === TODAY)!, week = weeks.find((w: any) => w.start_date <= TODAY && TODAY <= w.end_date)
    return { date: TODAY, day, week, phase: phases.find((p: any) => p.start_date <= TODAY && TODAY <= p.end_date),
      due: { cards: cards.filter((c) => c.due_on <= TODAY).length, mistakes: 3 },
      streaks: { study: { current: 4, longest: 9, today_done: false }, gym: { current: 2, longest: 6, today_done: true }, revision: { current: 0, longest: 3 }, job: { current: 5, longest: 5, today_done: true } } }
  }
  if (path === '/plan/weeks' && method === 'GET') return { items: weeks, next: null }
  if (path === '/plan' && method === 'GET') {
    const from = q.get('from') ?? TODAY, to = q.get('to') ?? addDays(TODAY, 14)
    return { phases, weeks, days: days.filter((d) => d.date >= from && d.date <= to) }
  }
  if ((r = m(/^\/plan\/tasks\/([^/]+)\/complete$/))) { const t = days.flatMap((d) => d.tasks).find((x) => x.id === r![1]); if (t) { t.status = 'done'; t.done_minutes = body?.done_minutes ?? t.est_minutes } return t }
  if ((r = m(/^\/plan\/tasks\/([^/]+)$/)) && method === 'PATCH') {
    const t = days.flatMap((d) => d.tasks).find((x) => x.id === r![1]); if (!t) return null
    if (body.date && body.date !== t.date) { const from = days.find((d) => d.date === t.date)!; from.tasks = from.tasks.filter((x: any) => x !== t); const to = days.find((d) => d.date === body.date); to?.tasks.push(t) }
    Object.assign(t, body); return t
  }
  if (path === '/plan/tasks' && method === 'POST') { const d = days.find((x) => x.date === body.date); const t = { id: 't' + ++tid, status: 'todo', done_minutes: 0, sort: 99, ...body }; d?.tasks.push(t); return t }
  if ((r = m(/^\/plan\/days\/([^/]+)\/capacity$/))) { const d = days.find((x) => x.date === r![1]); if (d) d.available_minutes = body.minutes; return { changes: [], overflow: [] } }
  if (path === '/plan/reschedule') return { changes: body.dry_run ? [{ task_id: 't12345', from: TODAY, to: addDays(TODAY, 1), est_minutes: 30, reason: 'over capacity' }] : [], overflow: [] }
  if ((r = m(/^\/plan\/weeks\/([^/]+)$/))) { const w = weeks.find((x: any) => x.id === r![1]); Object.assign(w, body); return w }
  if (path === '/topics') {
    const qs2 = await loadQs()
    return { items: topics.map((t) => ({ ...t, question_count: qs2.filter((x) => x.topic_id === t.id).length, progress: { status: 'todo', confidence: null } })) }
  }
  if (path === '/concepts') {
    const items = (await Promise.all(Object.values(ladders).map(load => load()))).flatMap(({ default: file }) =>
      (file.blueprint?.atoms ?? []).map((atom: any) => ({ topic_id: file.topic_id, atom_id: atom.id, name: atom.name, one_line: atom.one_line, has_card: true })))
    return { items }
  }
  if (path === '/concepts/progress') return { items: [...conceptProgress].map(([key, status]) => { const [topic_id, atom_id] = key.split('/'); return { topic_id, atom_id, status } }) }
  if ((r = m(/^\/concepts\/([^/]+)\/([^/]+)$/))) {
    const key = `${decodeURIComponent(r[1])}/${decodeURIComponent(r[2])}`
    if (method === 'DELETE' || body?.status === null) conceptProgress.delete(key)
    else conceptProgress.set(key, body?.status ?? 'got_it')
    return { status: conceptProgress.get(key) ?? null }
  }
  if ((r = m(/^\/topics\/([^/]+)\/blueprint$/))) return (await contentFile(ladders, 'ladders', decodeURIComponent(r[1])))?.blueprint ?? null
  if ((r = m(/^\/topics\/([^/]+)\/explainer$/))) return await contentFile(explainers, 'explainers', decodeURIComponent(r[1]))
  if ((r = m(/^\/topics\/([^/]+)\/progress$/))) return ok({})
  if (path === '/videos') return { items: (topics.find((t) => t.id === q.get('topic_id'))?.videos ?? []).map((v: any) => ({ ...v, source: v.lang })) }
  if (path === '/questions') return { items: await loadQs(), next: null }
  if ((r = m(/^\/questions\/([^/]+)$/))) { if (method === 'PATCH') return null; return (await loadQs()).find((x) => x.id === r![1]) }
  if (path === '/attempts') {
    if (method === 'POST') {
      const qq = (await loadQs()).find((x) => x.id === body.question_id)
      attempts.push({ ...body })
      return { attempt: body, mistake: null, qq }
    }
    return { items: [], next: null }
  }
  if (path === '/mistakes') { const qs2 = await loadQs(); if (!mistakes.length) qs2.filter((x) => x.q_type === 'MCQ' && x.image).slice(0, 3).forEach((x, i) => mistakes.push({ id: 'mi' + i, question_id: x.id, stage: 0, due_on: TODAY, status: 'open' })); return { items: mistakes.filter((x) => x.status === 'open').map((x) => ({ ...x, question: qs2.find((y) => y.id === x.question_id) })) } }
  if ((r = m(/^\/mistakes\/([^/]+)\/review$/))) return null
  if (path === '/cards/due') return { items: cards.filter((c) => c.due_on <= TODAY) }
  if (path === '/cards') { if (method === 'POST') { const c = { id: uuid7(), ease: 2.5, interval_d: 0, reps: 0, due_on: TODAY, ...body }; cards.push(c); return c } const t = q.get('topic_id'); return { items: t ? cards.filter((c) => c.topic_id === t) : cards } }
  if ((r = m(/^\/cards\/([^/]+)\/review$/))) { const c = cards.find((x) => x.id === r![1]); if (c && body.grade >= 3) c.due_on = addDays(TODAY, 3); return c }
  if (path === '/games/pairs') { const t = q.get('topic_id'); const p = cards.filter((c) => c.kind === 'pair' && (!t || c.topic_id === t)).slice(0, 6); return { round: p.map((c) => ({ card_id: c.id, left: c.front, right: c.back })) } }
  if (path === '/games/scores') return null
  if (path === '/checkins' && method === 'GET') return { items: checkins }
  if ((r = m(/^\/checkins\/([^/]+)$/))) { const c = { date: r[1], ...body }; const i = checkins.findIndex((x) => x.date === r![1]); if (i >= 0) checkins[i] = c; else checkins.push(c); return c }
  if (path === '/mocks') { if (method === 'POST') { const x = { id: uuid7(), ...body }; mocks.push(x); return x } return { items: mocks } }
  if (path === '/jobs') { if (method === 'POST') { const x = { id: uuid7(), ...body }; jobs.push(x); return x } return { items: jobs } }
  if ((r = m(/^\/jobs\/([^/]+)$/))) { const j = jobs.find((x) => x.id === r![1]); Object.assign(j, body); return j }
  if (path === '/streaks') return { study: { current: 4, longest: 9 }, gym: { current: 2, longest: 6 }, revision: { current: 0, longest: 3 }, job: { current: 5, longest: 5 } }
  if (path === '/stats/overview') return {
    days_to_exam: 123, plan_adherence: { planned_min: 2400, done_min: 1710, by_week: weeks.slice(0, 6).map((w: any, i: number) => ({ week_no: w.week_no, planned_min: 1500 + i * 120, done_min: i < 3 ? 1100 + i * 150 : 0 })) },
    accuracy_by_topic: [{ topic_id: 'prob', attempts: 12, correct: 5 }, { topic_id: 'la', attempts: 8, correct: 6 }, { topic_id: 'algo', attempts: 5, correct: 4 }],
    mock_trend: { CS: [{ score: 38 }, { score: 44 }], DA: [{ score: 46 }] },
  }
  if (path === '/export') return { exported_at: new Date().toISOString(), mock: true }
  console.warn('mock: unhandled', method, rawPath); return null
}
