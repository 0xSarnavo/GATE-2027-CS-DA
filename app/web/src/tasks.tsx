import { useState } from 'preact/hooks'
import type { Task } from './types'
import { Icon, Sheet, Field, toast } from './ui'
import { completeTask, patchTask, patchCache, isQueued, getConcepts, getConceptProgress } from './api'
import { addDays, cx, fmtMin, useLongPress } from './util'
import { Md } from './md'
import { go } from './router'
import { parseTaskTitle } from '../../shared/auto-task'

/** Open the work itself. Title hints cover older seeded rows without topic_id. */
export async function startTask(t: Task) {
  const parsed = parseTaskTitle(t.title, t.type)
  const kind = t.task_kind || parsed.kind, topic = t.topic_id || t.target_topic_id || parsed.topic_id
  if (kind === 'gym') return
  if (topic && /^Readiness check:/i.test(t.title)) return go(`learn/readiness/${topic}`)
  if (kind === 'job') return go('log/jobs?start=1')
  if (kind === 'syllabus') return go('learn')
  if (kind === 'mistakes') return go('mistakes')
  if (kind === 'flashcards' || t.type === 'revision') return go('cards/review')
  if (kind === 'mock') {
    const setup = /mock equivalent|full mock/i.test(t.title) ? 'mock' :
      /full (?:CS|DA) paper|diagnostic (?:CS|DA)|recent (?:CS|DA) paper/i.test(t.title) ? 'paper' :
      /sectional|diagnostic|timed mixed|set/i.test(t.title) ? 'quick' : 'mock'
    const count = parsed.count && parsed.count >= 5 && parsed.count <= 65 ? `&count=${parsed.count}` : ''
    return go(`test?setup=${setup}${/\bCS\b/i.test(t.title) ? '&paper=CS' : /\bDA\b/i.test(t.title) ? '&paper=DA' : ''}${setup === 'quick' ? count : ''}${/\bGA\b/i.test(t.title) ? '&subject=ga' : ''}`)
  }
  if (kind === 'questions' && topic) {
    const count = parsed.count ?? 10
    if (count >= 5 && count <= 65) {
      const { begin } = await import('./modules/test/Test')
      return begin('quick', { topic_id: topic, easy_to_hard: true, task_preset: true }, count)
    }
    return go(`practice/${topic}?mode=free`)
  }
  if (t.type === 'GA' && !topic) return go('practice/ga')
  if (kind === 'pyq' && topic) return go(`practice/${topic}?mode=free&source=pyq`)
  if (topic) {
    try {
      const [concepts, progress] = await Promise.all([getConcepts(), getConceptProgress()])
      const first = concepts.items.find(c => c.topic_id === topic && progress.get(topic + '/' + c.atom_id) !== 'got_it')
      return go(first ? `learn/${topic}/${first.atom_id}` : `learn/${topic}`)
    } catch { return go(`learn/${topic}`) }
  }
  return go(kind === 'pyq' ? 'practice' : 'learn')
}

export const TYPE_LABEL: Record<string, string> = { study: 'Study', pyq: 'Past-paper practice', revision: 'Revision', mock: 'Mock', GA: 'General aptitude', job: 'Job hunt', gym: 'Gym' }
export const isGymTask = (t: Task) => t.task_kind === 'gym' || parseTaskTitle(t.title, t.type).kind === 'gym'
const TYPE_ORDER = ['study', 'pyq', 'revision', 'mock', 'GA', 'job', 'gym']

export function mapRawTasks(raw: any, fn: (ts: Task[]) => Task[]) {
  if (raw?.day?.tasks) return { ...raw, day: { ...raw.day, tasks: fn(raw.day.tasks) } }
  if (raw?.tasks) return { ...raw, tasks: fn(raw.tasks) }
  return raw
}

export function groupTasks(tasks: Task[]): [string, Task[]][] {
  const m = new Map<string, Task[]>()
  const hasBlocks = tasks.some((t) => t.time_block)
  const sorted = [...tasks].sort((a, b) => (a.time_block && b.time_block ? a.time_block.localeCompare(b.time_block) : 0) || (a.sort ?? 0) - (b.sort ?? 0))
  for (const t of sorted) {
    const k = hasBlocks && t.time_block ? t.time_block.replace('-', ' - ') : (TYPE_LABEL[t.type] ?? t.type)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(t)
  }
  const entries = [...m.entries()]
  if (!hasBlocks) entries.sort((a, b) => TYPE_ORDER.indexOf(a[1][0].type) - TYPE_ORDER.indexOf(b[1][0].type))
  return entries
}

export const plannedMin = (ts: Task[]) => ts.filter((t) => t.status !== 'skipped' && t.status !== 'moved').reduce((s, t) => s + (t.est_minutes || 0), 0)
/** Study-ish minutes only: job hunt, gym and check-ins are on the day but are not study time. */
export const NON_STUDY = new Set(['job', 'gym', 'checkin'])
export const studyTasks = (ts: Task[]) => ts.filter((t) => !t.fixed && !NON_STUDY.has(t.type))
export const doneMin = (ts: Task[]) => ts.reduce((s, t) => s + (t.status === 'done' ? t.done_minutes || t.est_minutes || 0 : t.done_minutes || 0), 0)

/** Optimistic task mutations: `update(id, patch)` edits local state, `null` removes the task. */
export function useTaskActions(update: (id: string, p: Partial<Task> | null) => void, after?: () => void) {
  const [menu, setMenu] = useState<Task | null>(null)
  const [edit, setEdit] = useState<Task | null>(null)
  const persist = (id: string, p: Partial<Task> | null) =>
    patchCache('/plan/today', (v: any) => mapRawTasks(v, (ts) => (p ? ts.map((t) => (t.id === id ? { ...t, ...p } : t)) : ts.filter((t) => t.id !== id))))
  const run = async (t: Task, local: Partial<Task> | null, call: () => Promise<any>, msg?: string) => {
    update(t.id, local); persist(t.id, local)
    try { const r = await call(); if (isQueued(r)) toast('Saved offline, will sync'); else if (msg) toast(msg); after?.() }
    catch (e: any) { update(t.id, t); persist(t.id, t); toast(e?.message || 'Could not save') }
  }
  const toggle = (t: Task) =>
    t.status === 'done'
      ? run(t, { status: 'todo', done_minutes: 0, auto_done: 0, auto_reason: null }, () => patchTask(t.id, { status: 'todo', done_minutes: 0 }))
      : run(t, { status: 'done', done_minutes: t.est_minutes }, () => completeTask(t.id, t.est_minutes))
  const complete = (t: Task, m: number) => run(t, { status: 'done', done_minutes: m }, () => completeTask(t.id, m), `Done, ${m} min`)
  const undo = (t: Task) => { update(t.id, t); persist(t.id, t); patchTask(t.id, { date: t.date, status: t.status, done_minutes: t.done_minutes, est_minutes: t.est_minutes }).then(() => after?.()).catch((e: any) => toast(e.message || "Could not undo")) }
  const skip = (t: Task) => { run(t, { status: t.status === 'skipped' ? 'todo' : 'skipped' }, () => patchTask(t.id, { status: t.status === 'skipped' ? 'todo' : 'skipped' })); toast(t.status === 'skipped' ? 'Restored' : 'Skipped', { label: 'Undo', run: () => undo(t) }) }
  const tomorrow = (t: Task) => { run(t, null, () => patchTask(t.id, { date: addDays(t.date, 1) })); toast('Moved to tomorrow', { label: 'Undo', run: () => undo(t) }) }
  const setMinutes = (t: Task, m: number) => run(t, { est_minutes: m }, () => patchTask(t.id, { est_minutes: m }), 'Updated')

  const sheets = (
    <>
      {menu && (
        <Sheet title="Task options" onClose={() => setMenu(null)}><Md text={menu.title} />
          <div class="actions">
            <button class="btn block" onClick={() => { toggle(menu); setMenu(null) }}>{menu.status === 'done' ? 'Mark not done' : 'Mark done'}</button>
            <button class="btn block" onClick={() => { skip(menu); setMenu(null) }}>{menu.status === 'skipped' ? 'Restore task' : 'Skip'}</button>
            {!menu.fixed && <button class="btn block" onClick={() => { tomorrow(menu); setMenu(null) }}>Move to tomorrow</button>}
            <button class="btn block" onClick={() => { setEdit(menu); setMenu(null) }}>Edit minutes</button>
          </div>
        </Sheet>
      )}
      {edit && <EditMinutes t={edit} onClose={() => setEdit(null)} onSave={(m) => { setMinutes(edit, m); setEdit(null) }} />}
    </>
  )
  return { toggle, complete, skip, tomorrow, openMenu: setMenu, sheets }
}

function EditMinutes({ t, onClose, onSave }: { t: Task; onClose: () => void; onSave: (m: number) => void }) {
  const [v, setV] = useState(String(t.est_minutes))
  return (
    <Sheet title="Edit minutes" onClose={onClose}>
      <Field label="Estimated minutes" hint={t.min_minutes ? `Smallest useful version: ${t.min_minutes} min` : undefined}>
        <input type="number" inputMode="numeric" min="5" step="5" value={v} autoFocus onInput={(e) => setV((e.target as HTMLInputElement).value)} />
      </Field>
      <button class="btn primary block" disabled={!(+v > 0)} onClick={() => onSave(Math.round(+v))}>Save</button>
    </Sheet>
  )
}

export function TaskRow({ t, toggle, skip, tomorrow, openMenu, current, compact }: { compact?: boolean; t: Task; toggle: (t: Task) => void; skip?: (t: Task) => void; tomorrow?: (t: Task) => void; openMenu: (t: Task) => void; current?: boolean }) {
  const lp = useLongPress(() => openMenu(t))
  const [swiped, setSwiped] = useState(false)
  let touchX = 0, touchY = 0
  const done = t.status === 'done', skipped = t.status === 'skipped'
  return (
    <li {...lp} onTouchStart={(e) => { lp.onTouchStart(); touchX = e.touches[0].clientX; touchY = e.touches[0].clientY }} onTouchEnd={(e) => { lp.onTouchEnd(e); if (Math.abs(e.changedTouches[0].clientX - touchX) > 55 && Math.abs(e.changedTouches[0].clientY - touchY) < 40) { e.preventDefault(); setSwiped(true) } }} class={cx('task', done && 'done', skipped && 'skipped', t.priority === 1 && 'must', current && 'focus-t')}>
      {!isGymTask(t) && <button class="check" role="checkbox" aria-checked={done} aria-label={`${done ? 'Untick' : 'Tick'} ${t.title}`} onClick={() => toggle(t)}>
        {done && <Icon.check size={18} />}
      </button>}
      <div class="task-body" role={isGymTask(t) ? undefined : 'button'} tabIndex={isGymTask(t) ? undefined : 0}
        onClick={() => { if (!isGymTask(t)) startTask(t).catch((e: any) => toast(e.message)) }}
        onKeyDown={(e) => { if (!isGymTask(t) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startTask(t).catch((x: any) => toast(x.message)) } }}>
        <div class="task-title"><Md text={t.title} /></div>
        <div class="task-meta">
          {!isGymTask(t) && <span>{fmtMin(t.est_minutes)}</span>}
          {compact && t.time_block && <span>{t.time_block.replace('-', ' - ')}</span>}
          {!compact && t.type && <span class={'tag t-' + t.type}>{isGymTask(t) ? 'Gym reminder' : (t.fixed && t.type === 'study' ? 'Routine' : TYPE_LABEL[t.type] ?? t.type)}</span>}
          {(t.carried_over_from || (t.carry_count ?? 0) > 0) && <span class="tag carry">carried over{t.carry_count && t.carry_count > 1 ? ` ${t.carry_count} times` : ''}</span>}
          {!compact && t.priority === 1 && !t.fixed && <span class="tag must">must do</span>}
          {!compact && !!t.fixed && <span class="tag">fixed</span>}
          {skipped && <span class="tag">skipped</span>}
          {t.status === 'doing' && <span class="tag doing">in progress</span>}
          {done && !!t.auto_done && <span class="tag">Done automatically · {t.auto_reason}</span>}
        </div>
      </div>
      {!isGymTask(t) && <div class={cx('swipe-actions', swiped && 'revealed')}><button class="btn sm" onClick={() => { toggle(t); setSwiped(false) }}>{done ? 'Undo done' : 'Done'}</button>{skip && <button class="btn sm" onClick={() => { skip(t); setSwiped(false) }}>Skip</button>}{!t.fixed && tomorrow && <button class="btn sm" onClick={() => { tomorrow(t); setSwiped(false) }}>Move</button>}</div>}
      {!isGymTask(t) && <button class="icon-btn sm" aria-label="Task options" onClick={() => openMenu(t)}><Icon.more size={20} /></button>}
    </li>
  )
}

const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0) }
/** The one task to do: the block in progress, else the earliest open task (missed = "late", future = "next"). `now` = minutes since midnight, or -1 when viewing another day. */
export function pickFocus(tasks: Task[], now: number): { task: Task; when: 'now' | 'late' | 'next' | 'open'; range?: string } | null {
  const open = groupTasks(tasks).flatMap(([, ts]) => ts).filter((x) => !isGymTask(x) && x.status !== 'done' && x.status !== 'skipped' && x.status !== 'moved')
  if (!open.length) return null
  const blk = (x: Task) => (x.time_block && /^\d\d:\d\d-\d\d:\d\d$/.test(x.time_block) ? x.time_block.split('-').map(toMin) : null)
  const range = (x: Task) => x.time_block?.replace('-', ' - ')
  if (now >= 0) {
    const cur = open.find((x) => { const b = blk(x); return b && b[0] <= now && now < b[1] })
    if (cur) return { task: cur, when: 'now', range: range(cur) }
    const b = blk(open[0])
    if (b) return { task: open[0], when: b[1] <= now ? 'late' : 'next', range: range(open[0]) }
  }
  return { task: open[0], when: 'open', range: range(open[0]) }
}
