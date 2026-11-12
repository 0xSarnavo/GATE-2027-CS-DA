import { useState } from 'preact/hooks'
import { getFullPlan, patchWeek, reschedule, addTask, undoRevision, isQueued, type PlanData } from '../../api'
import { Header, Loading, useLoad, Bar, Sheet, Field, toast, Icon } from '../../ui'
import { addDays, cx, fmtDate, fmtMin, today } from '../../util'
import { go } from '../../router'
import { groupTasks, plannedMin, doneMin, TaskRow, useTaskActions, TYPE_LABEL } from '../../tasks'
import type { Day, Goal, Task, Week } from '../../types'
import { Md } from '../../md'
import { planDate } from './plan-date'

const goalPct = (g: Goal) => (g.target ? Math.min(1, (g.current ?? g.progress ?? (g.done ? g.target : 0)) / g.target) : g.done ? 1 : 0)

export default function Plan({ date }: { date?: string }) {
  const { data, error, loading, reload, set } = useLoad<PlanData>(getFullPlan, [])
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [resch, setResch] = useState<any>(null)
  const update = (id: string, p: Partial<Task> | null) =>
    set((d) => d && { ...d, days: d.days.map((dy) => ({ ...dy, tasks: p ? dy.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) : dy.tasks.filter((t) => t.id !== id) })) })
  const { toggle, skip, tomorrow, openMenu, sheets } = useTaskActions(update, reload)

  if (loading || !data) return <><Header title="Plan" /><main class="page"><Loading error={error} retry={reload} /></main></>
  const { phases, weeks, days } = data
  const t0 = today()
  const target = planDate(date)
  let wi = weeks.findIndex((w) => w.start_date <= target && target <= w.end_date)
  if (wi < 0) wi = target < (weeks[0]?.start_date ?? '') ? 0 : weeks.length - 1
  const week = weeks[wi] as Week | undefined
  if (!week) return <><Header title="Plan" /><main class="page"><p class="empty">No plan loaded yet.</p></main></>
  const wdays = days.filter((d) => d.date >= week.start_date && d.date <= week.end_date)
  const phase = phases.find((p) => p.id === week.phase_id)
  const goalsDone = week.macro_goals.filter((g) => g.done || goalPct(g) >= 1).length
  const nextGoal = week.macro_goals.find((g) => !g.done && goalPct(g) < 1)
  const dayCap = (d: Day) => d.available_minutes ?? 390
  const nav = (n: number) => { const w = weeks[wi + n]; if (w) go('plan/' + w.start_date) }

  const toggleGoal = (g: Goal, i: number) => {
    const goals = week.macro_goals.map((x, j) => (j === i ? { ...x, done: !x.done } : x))
    set((d) => d && { ...d, weeks: d.weeks.map((w) => (w.id === week.id ? { ...w, macro_goals: goals } : w)) })
    patchWeek(week.id, { macro_goals: goals }).then((r) => isQueued(r) && toast('Saved offline')).catch((e) => toast(e.message))
  }
  const preview = async () => {
    try { setResch(await reschedule(week.start_date, true)) } catch (e: any) { toast(e.message || 'Preview unavailable') }
  }
  const applyResch = async () => {
    try { const r: any = await reschedule(week.start_date, false); toast('Week rebalanced', r?.revision_id ? { label: 'Undo', run: () => undoRevision(r.revision_id).then(reload).catch((e: any) => toast(e.message)) } : undefined); setResch(null); reload() } catch (e: any) { toast(e.message) }
  }

  return (
    <>
      <Header title="Plan" sub={phase?.name} right={<button class="icon-btn" aria-label="Open calendar" onClick={() => go('calendar')}><Icon.cal /></button>} />
      <main class="page">
        <div class="weeknav">
          <button class="icon-btn" aria-label="Previous week" disabled={wi === 0} onClick={() => nav(-1)}><Icon.back /></button>
          <div>
            <b>Week {week.week_no}{week.title ? <><span>: </span><Md text={week.title}/></> : null}</b>
            <small>{fmtDate(week.start_date, { day: 'numeric', month: 'short' })} - {fmtDate(week.end_date, { day: 'numeric', month: 'short' })}</small>
          </div>
          <button class="icon-btn flip" aria-label="Next week" disabled={wi === weeks.length - 1} onClick={() => nav(1)}><Icon.back /></button>
        </div>
        <Timeline phases={phases} weeks={weeks} cur={wi} />

        <details class="plan-goals">
          <summary><span><b>Weekly goals</b><small>{goalsDone} of {week.macro_goals.length} complete{nextGoal ? ` · Next: ${nextGoal.text}` : ''}</small></span><Icon.chev size={18} /></summary>
          {week.macro_goals.length === 0 && <p class="muted">No goals set.</p>}
          <ul class="goals">
            {week.macro_goals.map((g, i) => (
              <li>
                <button class={cx('check sm', (g.done || goalPct(g) >= 1) && 'on')} role="checkbox" aria-checked={!!g.done} aria-label={g.text} onClick={() => toggleGoal(g, i)}>{(g.done || goalPct(g) >= 1) && <Icon.check size={14} />}</button>
                <div>
                  <div class={cx('goal-t', g.done && 'done')}><Md text={g.text}/></div>
                  {g.target ? <div class="goal-p"><Bar pct={goalPct(g)} /><small>{g.current ?? g.progress ?? 0}/{g.target}</small></div> : null}
                </div>
              </li>
            ))}
          </ul>
        </details>

        <section>
          <div class="row between"><h2 class="h">Days</h2><button class="btn sm" onClick={preview}>Reschedule week</button></div>
          <ul class="days">
            {wdays.map((d) => {
              const pl = plannedMin(d.tasks), dn = doneMin(d.tasks), cap = dayCap(d), isOpen = open === d.date
              return (
                <li class={cx('card day', d.date === t0 && 'today', isOpen && 'open')}>
                  <button class="day-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.date)}>
                    <span class="d"><b>{fmtDate(d.date, { weekday: 'short' })}</b><small>{fmtDate(d.date, { day: 'numeric', month: 'short' })}</small></span>
                    <span class="grow">
                      <Bar pct={cap ? pl / cap : 0} tone={pl > cap * 1.15 ? 'warn' : undefined} />
                      <small>{fmtMin(dn)} done / {fmtMin(pl)} planned of {fmtMin(cap)}{d.day_kind && d.day_kind !== 'normal' ? ` - ${d.day_kind}` : ''}</small>
                    </span>
                    <span class="chev"><Icon.chev size={18} /></span>
                  </button>
                  {isOpen && (
                    <div class="day-b">
                      {d.note && <Md text={d.note} class="muted"/>}
                      {groupTasks(d.tasks).map(([l, ts]) => (
                        <div><h3>{l}</h3><ul class="tasks">{ts.map((t) => <TaskRow key={t.id} t={t} toggle={toggle} skip={skip} tomorrow={tomorrow} openMenu={openMenu} />)}</ul></div>
                      ))}
                      <button class="btn sm" onClick={() => setAdding(d.date)}><Icon.plus size={16} /> Add task</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      </main>
      {sheets}
      {adding && <AddTask date={adding} onClose={() => setAdding(null)} onDone={() => { setAdding(null); reload() }} />}
      {resch && (
        <Sheet title="Reschedule preview" onClose={() => setResch(null)}>
          {(resch.changes?.length ?? 0) === 0 ? <p>Nothing to change. The week is already balanced.</p> : (
            <ul class="changes">{resch.changes.slice(0, 20).map((c: any) => <li><b><Md text={(c.title ?? c.task_id).slice(0, 44)}/></b> {c.op}: {c.from} to {c.to} ({c.est_minutes}m) <small>{c.reason}</small></li>)}</ul>
          )}
          {resch.overflow?.length ? <p class="muted">{resch.overflow.length} would move to next week.</p> : null}
          <button class="btn primary block" disabled={!resch.changes?.length} onClick={applyResch}>Apply</button>
        </Sheet>
      )}
    </>
  )
}

function Timeline({ phases, weeks, cur }: { phases: PlanData['phases']; weeks: Week[]; cur: number }) {
  const start = phases[0]?.start_date ?? weeks[0].start_date
  const end = phases[phases.length - 1]?.end_date ?? weeks[weeks.length - 1].end_date
  const span = Math.max(1, (Date.parse(end) - Date.parse(start)) / 864e5)
  const pos = (d: string) => Math.max(0, Math.min(100, ((Date.parse(d) - Date.parse(start)) / 864e5 / span) * 100))
  return (
    <div class="timeline" aria-label="Phase timeline">
      <div class="tl-bar">
        {phases.map((p, i) => <i class={'ph ph' + (i % 4)} title={p.name} style={{ left: pos(p.start_date) + '%', width: pos(p.end_date) - pos(p.start_date) + '%' }} />)}
        {weeks.map((w, i) => <button aria-label={`Week ${w.week_no}`} class={cx('tl-w', i === cur && 'on')} style={{ left: pos(w.start_date) + '%' }} onClick={() => go('plan/' + w.start_date)} />)}
        <b class="tl-now" style={{ left: pos(today()) + '%' }} />
      </div>
      <div class="tl-l">{phases.map((p, i) => p.id === weeks[cur]?.phase_id && <span class={'k ph' + (i % 4)}>{p.name}: {fmtDate(p.start_date, { day: 'numeric', month: 'short' })} to {fmtDate(p.end_date, { day: 'numeric', month: 'short' })}</span>)}</div>
    </div>
  )
}

function AddTask({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(''); const [type, setType] = useState('study'); const [m, setM] = useState('45')
  const save = async () => {
    try { const r = await addTask({ date, title: title.trim(), type, est_minutes: +m || 30, priority: 2 }); toast(isQueued(r) ? 'Saved offline' : 'Task added'); onDone() } catch (e: any) { toast(e.message) }
  }
  return (
    <Sheet title={`Add task - ${fmtDate(date)}`} onClose={onClose}>
      <Field label="Title"><input value={title} autoFocus onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></Field>
      <div class="two">
        <Field label="Type"><select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option value={k}>{v}</option>)}</select></Field>
        <Field label="Minutes"><input type="number" inputMode="numeric" value={m} onInput={(e) => setM((e.target as HTMLInputElement).value)} /></Field>
      </div>
      <button class="btn primary block" disabled={!title.trim()} onClick={save}>Add</button>
    </Sheet>
  )
}
void addDays
