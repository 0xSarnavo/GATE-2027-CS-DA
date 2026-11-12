import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { getFullPlan, getSettings, getTopics, patchTask, completeTask, isQueued, type PlanData } from '../../api'
import { Header, Loading, useLoad, Ring, Seg, Sheet, Field, Empty, Icon, toast } from '../../ui'
import { cx, fmtDate, fmtMin, today as todayFn, addDays } from '../../util'
import { go } from '../../router'
import { Md } from '../../md'
import type { Day, Task, Topic } from '../../types'
import { MONTH_KEYS, PHASE_LABEL, STATE_LABEL, byTime, clampMonth, dayStat, monthGrid, monthLabel, phaseFor, phaseKind, taskState, updateTaskInDays, weeksWithDays, type PhaseKind } from './calendar-lib'
import { TYPE_LABEL, startTask, isGymTask } from '../../tasks'

type View = 'month' | 'agenda'
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function useCalendarData() {
  const plan = useLoad<PlanData>(getFullPlan, [])
  const topics = useLoad(() => getTopics().catch(() => [] as Topic[]), [])
  const settings = useLoad(() => getSettings().catch(() => ({} as Record<string, any>)), [])
  const names = useMemo(() => new Map((topics.data ?? []).map((t) => [t.id, t.name])), [topics.data])
  const dayMap = useMemo(() => new Map((plan.data?.days ?? []).map((d) => [d.date, d])), [plan.data])
  const update = (id: string, p: Partial<Task>) =>
    plan.set((d) => d && { ...d, days: updateTaskInDays(d.days, id, p) })
  return { plan, names, dayMap, exam: (settings.data?.exam_date as string | undefined) ?? '', update }
}

export default function Calendar({ parts, query }: { parts: string[]; query: URLSearchParams }) {
  const [a, b] = parts
  if (a === 'day' && b) return <DayAgenda date={b} />
  return <Overview view={a === 'agenda' ? 'agenda' : 'month'} month={query.get('m') ?? ''} />
}

function Overview({ view, month }: { view: View; month: string }) {
  const { plan, dayMap, exam } = useCalendarData()
  const t0 = todayFn()
  const ym = clampMonth(/^\d{4}-\d\d$/.test(month) ? month : t0.slice(0, 7))
  const setView = (v: View) => go(v === 'agenda' ? 'calendar/agenda' : 'calendar?m=' + ym, true)
  return (
    <>
      <Header title="Calendar" sub={view === 'month' ? 'Tap a day to see its tasks.' : 'Every upcoming day, week by week.'} onBack={() => go('plan')} />
      <main class="page cal-page">
        <Seg value={view} onChange={setView} options={[['month', 'Month'], ['agenda', 'Agenda']]} />
        {plan.loading || !plan.data ? <Loading error={plan.error} retry={plan.reload} />
          : view === 'month' ? <MonthView ym={ym} plan={plan.data} dayMap={dayMap} exam={exam} t0={t0} />
          : <AgendaView plan={plan.data} exam={exam} t0={t0} />}
      </main>
    </>
  )
}

function MonthView({ ym, plan, dayMap, exam, t0 }: { ym: string; plan: PlanData; dayMap: Map<string, Day>; exam: string; t0: string }) {
  const cells = monthGrid(ym)
  const i = MONTH_KEYS.indexOf(ym)
  const to = (m: string) => go('calendar?m=' + m, true)
  const prev = i > 0 ? MONTH_KEYS[i - 1] : null, next = i < MONTH_KEYS.length - 1 ? MONTH_KEYS[i + 1] : null
  const touch = useRef({ x: 0, y: 0 })
  const kinds = new Set<PhaseKind>()
  return (
    <section aria-label={monthLabel(ym)} onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
      onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - touch.current.x, dy = e.changedTouches[0].clientY - touch.current.y; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { const m = dx < 0 ? next : prev; if (m) to(m) } }}>
      <div class="cal-nav">
        <button class="icon-btn" aria-label="Previous month" disabled={!prev} onClick={() => prev && to(prev)}><Icon.back /></button>
        <h2 aria-live="polite">{monthLabel(ym)}</h2>
        <button class="icon-btn flip" aria-label="Next month" disabled={!next} onClick={() => next && to(next)}><Icon.back /></button>
      </div>
      <div class="cal-dow" aria-hidden="true">{DOW.map((d) => <span>{d}</span>)}</div>
      <div class="cal-grid" role="grid">
        {cells.map((date) => {
          if (!date) return <span class="cal-pad" role="gridcell" aria-hidden="true" />
          const day = dayMap.get(date), st = dayStat(day), ph = phaseFor(plan.phases, date), kind = date === exam ? 'exam' : phaseKind(ph)
          if (day || ph) kinds.add(kind)
          const isExam = date === exam, inPlan = !!day
          const label = `${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}${date === t0 ? ', today' : ''}${isExam ? ', exam day' : ''}${ph ? ', ' + ph.name : ''}${st.planned ? `, ${st.done} of ${st.planned} study minutes done` : inPlan ? ', no study planned' : ''}${st.mock ? ', mock test' : ''}`
          return (
            <button role="gridcell" class={cx('cal-day', 'k-' + kind, date === t0 && 'today', isExam && 'exam', !inPlan && 'out', date < t0 && 'past')} aria-label={label} aria-current={date === t0 ? 'date' : undefined} onClick={() => go('calendar/day/' + date)}>
              <span class="cal-n">{+date.slice(8)}</span>
              {inPlan && <Ring pct={st.pct} size={30} stroke={4} color={st.pct >= 1 ? 'var(--gold)' : 'var(--orange)'}>{''}</Ring>}
              {isExam ? <span class="cal-mark exam-m" aria-hidden="true"><Icon.flag size={12} /></span> : st.mock ? <span class="cal-mark mock-m" aria-hidden="true">M</span> : null}
            </button>
          )
        })}
      </div>
      <ul class="cal-legend" aria-label="Legend">
        {(['habit', 'break', 'full', 'rev', 'exam'] as PhaseKind[]).filter((k) => kinds.has(k)).map((k) => <li><i class={'sw k-' + k} />{PHASE_LABEL[k]}</li>)}
        <li><span class="cal-mark mock-m" aria-hidden="true">M</span>Mock test</li>
        <li><span class="lg-ring" aria-hidden="true" />Study done</li>
      </ul>
    </section>
  )
}

const stateTag = (t: Task, today: string) => {
  const s = taskState(t, today)
  return s === 'todo' ? null : <span class={cx('tag', 'st-' + s)}>{STATE_LABEL[s]}</span>
}

function AgendaView({ plan, exam, t0 }: { plan: PlanData; exam: string; t0: string }) {
  const weeks = useMemo(() => weeksWithDays(plan.weeks, plan.days, t0), [plan, t0])
  const [shown, setShown] = useState(2)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = end.current; if (!el || shown >= weeks.length || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setShown((n) => n + 2) }, { rootMargin: '400px' })
    io.observe(el); return () => io.disconnect()
  }, [shown, weeks.length])
  if (!weeks.length) return <Empty art="rest" title="Nothing coming up">There are no planned days from today on.</Empty>
  return (
    <div class="agenda">
      {weeks.slice(0, shown).map(({ week, days }) => (
        <section class="ag-week" aria-label={`Week ${week.week_no}`}>
          <div class="ag-wh">
            <h2>Week {week.week_no}{week.title ? <>: <Md text={week.title} /></> : null}</h2>
            <small>{fmtDate(week.start_date, { day: 'numeric', month: 'short' })} to {fmtDate(week.end_date, { day: 'numeric', month: 'short' })}</small>
            {week.macro_goals.length > 0 && (
              <ul class="ag-goals" aria-label="Goals this week">
                {week.macro_goals.slice(0, 6).map((g) => <li class={cx(g.done && 'done')}><span aria-hidden="true">{g.done ? '✓' : '•'}</span><Md text={g.text} /></li>)}
              </ul>
            )}
          </div>
          <ul class="ag-days">
            {days.map((d) => {
              const st = dayStat(d), ph = phaseFor(plan.phases, d.date), tasks = byTime(d.tasks)
              return (
                <li class={cx('ag-day', d.date === t0 && 'today', d.date === exam && 'exam')}>
                  <button class="ag-dh" onClick={() => go('calendar/day/' + d.date)} aria-label={`Open ${fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}`}>
                    <b>{fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}{d.date === t0 ? ' · Today' : ''}{d.date === exam ? ' · Exam day' : ''}</b>
                    <small>{ph ? PHASE_LABEL[phaseKind(ph)] + ' · ' : ''}{fmtMin(st.done)} of {fmtMin(st.planned)}</small>
                    <Icon.chev size={18} />
                  </button>
                  <ul class="ag-tasks">
                    {tasks.map((t) => (
                      <li class={cx(t.status === 'done' && 'done', t.status === 'skipped' && 'skipped')}>
                        <span class="ag-time">{t.time_block ? t.time_block.slice(0, 5) : ''}</span>
                        <span class="ag-t"><Md text={t.title} /></span>
                        <span class="ag-m">{fmtMin(t.est_minutes)}{stateTag(t, t0)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {shown < weeks.length && <div ref={end}><button class="btn block" onClick={() => setShown((n) => n + 2)}>Show more weeks</button></div>}
    </div>
  )
}

function DayAgenda({ date }: { date: string }) {
  const { plan, names, dayMap, exam, update } = useCalendarData()
  const t0 = todayFn()
  const [moving, setMoving] = useState<Task | null>(null)
  if (plan.loading || !plan.data) return <><Header title={fmtDate(date)} onBack={() => go('calendar')} /><main class="page"><Loading error={plan.error} retry={plan.reload} /></main></>
  const day = dayMap.get(date), ph = phaseFor(plan.data.phases, date), st = dayStat(day)
  const tasks = byTime(day?.tasks ?? [])
  const first = plan.data.days[0]?.date ?? date, last = plan.data.days.at(-1)?.date ?? date
  const step = (n: number) => { const d = addDays(date, n); if (d >= first && d <= last) go('calendar/day/' + d, true) }
  const mutate = async (t: Task, local: Partial<Task>, call: () => Promise<any>, msg: string, undoPatch?: Partial<Task>) => {
    update(t.id, local)
    try {
      const r = await call()
      toast(isQueued(r) ? 'Saved offline, will sync' : msg, undoPatch ? { label: 'Undo', run: () => { update(t.id, undoPatch); patchTask(t.id, undoPatch).then((v) => { if (!isQueued(v)) plan.reload() }).catch((e: any) => { update(t.id, local); toast(e.message || 'Could not undo') }) } } : undefined)
      if (!isQueued(r)) plan.reload()
    } catch (e: any) { update(t.id, t); toast(e?.message || 'Could not save') }
  }
  const toggle = (t: Task) => t.status === 'done'
    ? mutate(t, { status: 'todo', done_minutes: 0 }, () => patchTask(t.id, { status: 'todo', done_minutes: 0 }), 'Marked not done')
    : mutate(t, { status: 'done', done_minutes: t.est_minutes }, () => completeTask(t.id, t.est_minutes), 'Marked done', { status: t.status, done_minutes: t.done_minutes ?? 0 })
  const move = (t: Task, to: string) => { setMoving(null); mutate(t, { date: to }, () => patchTask(t.id, { date: to }), `Moved to ${fmtDate(to, { weekday: 'short', day: 'numeric', month: 'short' })}`, { date: t.date }) }
  return (
    <>
      <Header title={fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })} sub={`${ph ? PHASE_LABEL[phaseKind(ph)] : 'Outside the plan'}${date === exam ? ' · Exam day' : ''}${date === t0 ? ' · Today' : ''}`} onBack={() => go('calendar')} />
      <main class="page cal-day-page">
        <div class="cal-step">
          <button class="icon-btn" aria-label="Previous day" disabled={addDays(date, -1) < first} onClick={() => step(-1)}><Icon.back /></button>
          <div class="cal-sum">
            <Ring pct={st.pct} size={52} stroke={7} color={st.pct >= 1 ? 'var(--gold)' : 'var(--orange)'}><b style="font-size:var(--t-xs)">{Math.round(st.pct * 100)}%</b></Ring>
            <div><b>{fmtMin(st.done)} of {fmtMin(st.planned)} studied</b><small>{tasks.length} task{tasks.length === 1 ? '' : 's'}{st.mock ? ' · mock test' : ''}</small></div>
          </div>
          <button class="icon-btn flip" aria-label="Next day" disabled={addDays(date, 1) > last} onClick={() => step(1)}><Icon.back /></button>
        </div>
        {day?.note && <p class="note"><Md text={day.note} /></p>}
        {tasks.length === 0 && <Empty art="rest" title="Nothing planned">This day has no tasks. Use Plan to add one.</Empty>}
        <ul class="ag-cards">
          {tasks.map((t) => {
            const s = taskState(t, t0), open = s !== 'done' && s !== 'skipped' && s !== 'moved', topic = t.topic_id ? names.get(t.topic_id) : null
            return (
              <li class={cx('card ag-card', 's-' + s)}>
                <div class="ag-top"><span class="ag-time">{t.time_block ? t.time_block.replace('-', ' - ') : 'Any time'}</span>
                  <span class="ag-chips"><span class="tag">{isGymTask(t) ? 'Gym reminder' : t.fixed && t.type === 'study' ? 'Routine' : TYPE_LABEL[t.type] ?? t.type}</span>{!isGymTask(t) && <span class="tag">{fmtMin(t.est_minutes)}</span>}<span class={cx('tag', 'st-' + s)}>{STATE_LABEL[s]}</span>{s !== 'carried' && !!t.carried_over_from && <span class="tag st-carried">Carried over</span>}</span></div>
                <h3 class="ag-title"><Md text={t.title} /></h3>
                {!!t.auto_done && <small>Done automatically · {t.auto_reason}</small>}
                {topic && <button class="link ag-chapter" onClick={() => go('learn/' + t.topic_id)}>{topic} <Icon.chev size={14} /></button>}
                {!!t.min_minutes && open && <small class="muted">Short on time? The smallest useful version is {t.min_minutes} min.</small>}
                <div class="ag-act">
                  {!isGymTask(t) && <button class={cx('btn sm', open && 'primary')} onClick={() => startTask(t).catch((e: any) => toast(e.message))}>{open ? 'Start' : 'Open'}</button>}
                  {!isGymTask(t) && <button class={cx('btn sm', !open && 'grow')} onClick={() => toggle(t)}>{t.status === 'done' ? 'Undo done' : 'Mark done'}</button>}
                  {!t.fixed && <button class="btn sm" onClick={() => setMoving(t)}>Move</button>}
                </div>
              </li>
            )
          })}
        </ul>
      </main>
      {moving && <MoveSheet t={moving} min={t0 > first ? t0 : first} max={last} onClose={() => setMoving(null)} onMove={(d) => move(moving, d)} />}
    </>
  )
}

function MoveSheet({ t, min, max, onClose, onMove }: { t: Task; min: string; max: string; onClose: () => void; onMove: (date: string) => void }) {
  const [d, setD] = useState(addDays(t.date, 1) <= max ? addDays(t.date, 1) : t.date)
  return (
    <Sheet title="Move to another day" onClose={onClose}>
      <p class="muted"><Md text={t.title} /></p>
      <Field label="New date"><input type="date" value={d} min={min} max={max} onInput={(e) => setD((e.target as HTMLInputElement).value)} /></Field>
      <button class="btn primary block" disabled={!d || d === t.date || d < min || d > max} onClick={() => onMove(d)}>Move task</button>
    </Sheet>
  )
}
