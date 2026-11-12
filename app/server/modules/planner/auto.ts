import { db } from '../../db'
import { now, todayIST } from '../../util'
import { getSetting, recomputeTaskMinutes, dueCounts } from '../../lib/services'
import { parseTaskTitle } from '../../../shared/auto-task'

const n = (sql: string, ...args: any[]) => Number((db.query(sql).get(...args) as any)?.n ?? 0)

export function taskTopic(t: any, hint = parseTaskTitle(t.title, t.type).topic_id): string | null {
  if (t.topic_id) return t.topic_id
  if (hint && db.query('SELECT 1 FROM topics WHERE id=? AND deleted_at IS NULL').get(hint)) return hint
  // Generic seeded titles that exactly name a chapter also work without an explicit map.
  const head = t.title.replace(/^(?:Study|Foundation|PYQs?|GA practice|Review)\s*:\s*/i, '').split(/[(:]/)[0].trim()
  return (db.query('SELECT id FROM topics WHERE lower(name)=lower(?) AND deleted_at IS NULL LIMIT 1').get(head) as any)?.id ?? null
}

export function effectiveMinutes(date: string, subject?: string): number {
  return n(`SELECT COALESCE(SUM(minutes),0) n FROM effective_study_minutes WHERE date=?${subject ? ' AND subject_id=?' : ''}`, ...(subject ? [date, subject] : [date]))
}

export function refreshAutoMinutes(date: string) {
  db.run("DELETE FROM study_minutes WHERE date=? AND source='auto'", [date])
  const rows = db.query("SELECT subject_id, CAST(SUM(seconds)/60 AS INTEGER) minutes FROM active_time_batches WHERE date=? AND kind='study' GROUP BY subject_id").all(date) as any[]
  for (const r of rows) if (r.minutes > 0) db.run("INSERT INTO study_minutes(date,subject_id,minutes,source,updated_at) VALUES (?,?,?,'auto',?)", [date, r.subject_id, r.minutes, now()])
}

export function jobMinutes(date: string) {
  return n("SELECT CAST(COALESCE(SUM(seconds),0)/60 AS INTEGER) n FROM active_time_batches WHERE date=? AND kind='job'", date)
}

export function jobCounts(date: string) {
  const row = db.query('SELECT job_applications,referrals_sent FROM checkins WHERE date=?').get(date) as any
  return {
    applications: Math.max(Number(row?.job_applications ?? 0), n('SELECT COUNT(*) n FROM jobs WHERE date_applied=? AND deleted_at IS NULL', date)),
    outreach: Number(row?.referrals_sent ?? 0),
  }
}

function topicAttempts(date: string, topic: string, official = false) {
  return n(`WITH RECURSIVE children(id) AS (SELECT id FROM topics WHERE id=? UNION ALL SELECT t.id FROM topics t JOIN children c ON t.parent_id=c.id)
    SELECT COUNT(*) n FROM attempts a JOIN questions q ON q.id=a.question_id
    WHERE date(a.at,'+330 minutes')=? AND q.topic_id IN children ${official ? "AND q.source='official'" : ''}`, topic, date)
}

function gotIt(topic: string) {
  const row = db.query(`SELECT COUNT(*) total, SUM(CASE WHEN cp.status='got_it' THEN 1 ELSE 0 END) done
    FROM topic_notes tn, json_each(tn.atoms) atom
    LEFT JOIN concept_progress cp ON cp.topic_id=tn.topic_id AND cp.atom_id=json_extract(atom.value,'$.id')
    WHERE tn.topic_id=?`).get(topic) as any
  return row?.total > 0 && row.done === row.total
}

/** The reason is deliberately a complete UI sentence; null means the evidence is insufficient. */
export function autoReason(t: any): string | null {
  const p = parseTaskTitle(t.title, t.type), topic = taskTopic(t, p.topic_id), date = t.date
  if (p.kind === 'gym' || p.kind === 'other' || p.kind === 'syllabus' || p.kind === 'mock' || p.kind === 'mistakes') return null
  if (p.kind === 'job') {
    const c = jobCounts(date), apps = Math.max(1, Number(getSetting('job_applications_target', '2')) || 2), outreach = Math.max(1, Number(getSetting('job_outreach_target', '2')) || 2)
    if (c.applications >= apps && c.outreach >= outreach) return `${c.applications}/${apps} applications · ${c.outreach}/${outreach} outreach`
    if (t.est_minutes > 0 && jobMinutes(date) >= t.est_minutes) return `${jobMinutes(date)}/${t.est_minutes} job minutes`
    return null
  }
  if (p.kind === 'flashcards') {
    const reviews = n("SELECT COUNT(*) n FROM card_reviews WHERE date(at,'+330 minutes')=?", date)
    if (p.count && reviews >= p.count) return `${reviews}/${p.count} cards reviewed`
    if (date === todayIST() && reviews > 0 && dueCounts(date).cards === 0) return 'All due cards reviewed'
    return null
  }
  if ((p.kind === 'questions' || p.kind === 'pyq') && (topic || t.subject_id)) {
    const required = p.count ?? (p.kind === 'pyq' ? 10 : null)
    if (!required) return null
    const attempts = topic ? topicAttempts(date, topic, p.kind === 'pyq') : n(`SELECT COUNT(*) n FROM attempts a JOIN questions q ON q.id=a.question_id JOIN topics x ON x.id=q.topic_id
      WHERE date(a.at,'+330 minutes')=? AND x.subject_id=? ${p.kind === 'pyq' ? "AND q.source='official'" : ''}`, date, t.subject_id)
    return attempts >= required ? `${attempts}/${required} ${p.kind === 'pyq' ? 'past-paper' : ''} questions`.replace(/  +/g, ' ') : null
  }
  if (p.kind === 'study' && topic) {
    const seconds = n("SELECT COALESCE(SUM(seconds),0) n FROM active_time_batches WHERE date=? AND kind='study' AND topic_id=?", date, topic)
    const mins = Math.floor(seconds / 60)
    if (t.est_minutes > 0 && mins >= t.est_minutes) return `${mins}/${t.est_minutes} active minutes`
    if (gotIt(topic)) return 'Every concept marked Got it'
  }
  return null
}

export function sweepAutoTasks(date = todayIST()) {
  const tasks = db.query("SELECT * FROM plan_tasks WHERE date=? AND status IN ('todo','doing') AND deleted_at IS NULL AND auto_undone_at IS NULL").all(date) as any[]
  const changed: string[] = []
  for (const t of tasks) {
    const reason = autoReason(t)
    if (!reason) continue
    db.run("UPDATE plan_tasks SET status='done',auto_done=1,auto_reason=?,completed_at=?,updated_at=? WHERE id=?", [reason, now(), now(), t.id])
    changed.push(t.id)
  }
  if (changed.length) recomputeTaskMinutes(date)
  return changed
}
