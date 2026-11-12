import type { Day, Phase, Task } from '../../types'
import { addDays } from '../../util'
// same rules as tasks.tsx (kept here so this file has no JSX imports and can be unit tested)
const NON_STUDY = new Set(['job', 'gym', 'checkin'])
const studyTasks = (ts: Task[]) => ts.filter((t) => !t.fixed && !NON_STUDY.has(t.type))
const plannedMin = (ts: Task[]) => ts.filter((t) => t.status !== 'skipped' && t.status !== 'moved').reduce((s, t) => s + (t.est_minutes || 0), 0)
const doneMin = (ts: Task[]) => ts.reduce((s, t) => s + (t.status === 'done' ? t.done_minutes || t.est_minutes || 0 : t.done_minutes || 0), 0)

export type PhaseKind = 'habit' | 'break' | 'full' | 'rev' | 'exam'
export const PHASE_LABEL: Record<PhaseKind, string> = { habit: 'Habit and ramp-up', break: 'Puja break', full: 'Full plan', rev: 'Revision', exam: 'Exam window' }

/** Month keys the calendar can show. */
export const MONTH_KEYS = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02']
export const monthLabel = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export const clampMonth = (ym: string) => (ym < MONTH_KEYS[0] ? MONTH_KEYS[0] : ym > MONTH_KEYS.at(-1)! ? MONTH_KEYS.at(-1)! : ym)
export const shiftMonth = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return t.toISOString().slice(0, 7) }

/** Cells for one month, Monday first. `null` pads the first and last week. */
export function monthGrid(ym: string): (string | null)[] {
  const [y, m] = ym.split('-').map(Number)
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= n; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7) cells.push(null)
  return cells
}

export function phaseKind(p?: Pick<Phase, 'id' | 'name'> | null): PhaseKind {
  const s = `${p?.id ?? ''} ${p?.name ?? ''}`.toLowerCase()
  if (/puja|break/.test(s)) return 'break'
  if (/exam/.test(s)) return 'exam'
  if (/taper|revision|final/.test(s)) return 'rev'
  if (/habit|re-?entry|ramp/.test(s)) return 'habit'
  return 'full'
}
export const phaseFor = (phases: Phase[], date: string) => phases.find((p) => p.start_date <= date && date <= p.end_date)

export type TaskState = 'done' | 'skipped' | 'moved' | 'missed' | 'carried' | 'todo'
export function taskState(t: Pick<Task, 'status' | 'date' | 'carried_over_from'>, today: string): TaskState {
  if (t.status === 'done') return 'done'
  if (t.status === 'skipped') return 'skipped'
  if (t.status === 'moved') return 'moved'
  if (t.date < today) return 'missed'
  return t.carried_over_from ? 'carried' : 'todo'
}
export const STATE_LABEL: Record<TaskState, string> = { done: 'Done', skipped: 'Skipped', moved: 'Moved', missed: 'Missed', carried: 'Carried over', todo: 'To do' }

const startOf = (t: Task) => (t.time_block && /^\d\d:\d\d/.test(t.time_block) ? t.time_block.slice(0, 5) : '99:99')
export const byTime = (ts: Task[]) => [...ts].sort((a, b) => startOf(a).localeCompare(startOf(b)) || (a.sort ?? 0) - (b.sort ?? 0))

/** Apply an optimistic task edit, including a date move, to the visible plan. */
export function updateTaskInDays(days: Day[], id: string, patch: Partial<Task>): Day[] {
  const task = days.flatMap((d) => d.tasks).find((t) => t.id === id)
  if (!task) return days
  const next = { ...task, ...patch }
  return days.map((d) => ({ ...d, tasks: [...d.tasks.filter((t) => t.id !== id), ...(d.date === next.date ? [next] : [])] }))
}

export interface DayStat { planned: number; done: number; pct: number; mock: boolean; tasks: number }
export function dayStat(d?: Day): DayStat {
  if (!d) return { planned: 0, done: 0, pct: 0, mock: false, tasks: 0 }
  const st = studyTasks(d.tasks), planned = plannedMin(st), done = doneMin(st)
  return { planned, done, pct: planned ? Math.min(1, done / planned) : 0, mock: d.tasks.some((t) => t.type === 'mock' && t.status !== 'skipped'), tasks: d.tasks.length }
}

/** Group days into the plan's weeks (a day outside every week is dropped). */
export function weeksWithDays<W extends { start_date: string; end_date: string }>(weeks: W[], days: Day[], from: string): { week: W; days: Day[] }[] {
  return weeks.map((week) => ({ week, days: days.filter((d) => d.date >= week.start_date && d.date <= week.end_date && d.date >= from) })).filter((w) => w.days.length)
}

/** Where "Start" goes for a task: the chapter, the test home, flashcards, or Today's timer. */
export function startTarget(t: Pick<Task, 'type' | 'topic_id' | 'date'>, today: string): string {
  if (t.type === 'mock') return 'test'
  if (t.type === 'revision' && !t.topic_id) return 'cards/review'
  if (t.type === 'pyq' && t.topic_id) return 'practice/' + t.topic_id
  if (t.topic_id && (t.type === 'study' || t.type === 'revision')) return 'learn/' + t.topic_id
  if (t.type === 'GA') return 'practice/ga'
  return t.date === today ? 'today' : 'plan/' + t.date
}
export { addDays }
