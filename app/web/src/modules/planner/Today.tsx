import { useModules } from '../index'
import { useEffect, useRef, useState } from 'preact/hooks'
import { getToday, getSettings, setCapacity, getCheckin, putCheckin, getMastery, getSubjects, isQueued, undoRevision } from '../../api'
import { Header, Loading, useLoad, Sheet, Field, Stepper, Empty, Icon, toast, Confetti, Art } from '../../ui'
import { cx, dayDiff, fmtDate, fmtMin, today as todayFn } from '../../util'
import { go } from '../../router'
import { xpToday, onXp } from '../../queue'
import { groupTasks, plannedMin, studyTasks, TaskRow, useTaskActions, pickFocus, TYPE_LABEL, startTask, isGymTask } from '../../tasks'
import { begin } from '../test/Test'
import type { Task, Today as TodayT } from '../../types'
import { Md } from '../../md'
import { GoalRings } from './GoalRings'
import { goalProgress } from './goal-progress'

interface Suggestion { key: string; title: string; line: string; cta: string; run: () => void }

/** One small line under the title: streak, points today and flashcards due. Each part opens its screen. */
function StatLine({ streak, done, cards, review }: { streak: number; done: boolean; cards: number; review: boolean }) {
  const [, f] = useState(0)
  useEffect(() => onXp(() => f((n) => n + 1)), [])
  const xp = xpToday()
  if (!streak && !xp && !(review && cards)) return null
  return (
    <p class="statline" aria-label="Your progress">
      {streak > 0 && <button onClick={() => go('stats')} aria-label={`${streak} day study streak${done ? ', done today' : ''}`}><Icon.flame size={16} />{streak}-day streak</button>}
      {xp > 0 && <button onClick={() => go('stats')} aria-label={`${xp} points earned today`}><Icon.bolt size={16} />{xp} points</button>}
      {review && cards > 0 && <button onClick={() => go('cards/review')} aria-label={`${cards} flashcards due`}><Icon.gem size={16} />{cards} cards due</button>}
    </p>
  )
}

export default function Today({ query }: { query?: URLSearchParams }) {
  const { data, error, loading, reload, set } = useLoad<TodayT>(getToday, [])
  const settings = useLoad(getSettings, [])
  const modules = useModules()
  const reviewEnabled = modules.some(m => m.id === 'review' && m.enabled)
  const practiceEnabled = modules.some(m => m.id === 'practice' && m.enabled)
  const learnEnabled = modules.some(m => m.id === 'learn' && m.enabled)
  const mastery = useLoad(() => getMastery().catch(() => null), [])
  const clock = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number)
  const evening = clock[0] >= 20
  const checkin = useLoad(() => getCheckin(todayFn()).catch(() => null), [])
  useEffect(() => {
    const refresh = () => { reload(); checkin.reload(); mastery.reload() }
    const timer = setInterval(() => { if (data?.date && data.date !== todayFn()) refresh() }, 60_000)
    addEventListener('online', refresh)
    return () => { clearInterval(timer); removeEventListener('online', refresh) }
  }, [data?.date])
  const [capOpen, setCapOpen] = useState(false)
  const [checkinOpen, setCheckinOpen] = useState(false)
  const [more, setMore] = useState(false)
  // the profile menu opens these two sheets: Check-in and Time available
  const sheet = query?.get('sheet')
  useEffect(() => { if (sheet === 'checkin') setCheckinOpen(true); if (sheet === 'time') setCapOpen(true); if (sheet) go('today', true) }, [sheet])
  const update = (id: string, p: Partial<Task> | null) =>
    set((d) => d?.day ? { ...d, day: { ...d.day, tasks: p ? d.day.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) : d.day.tasks.filter((t) => t.id !== id) } } : d)
  const { toggle, skip, tomorrow, openMenu, sheets } = useTaskActions(update, reload)

  if (loading || !data) return <><Header title="Today" sub="Your plan for today." /><main class="page"><Loading error={error} retry={reload} /></main></>
  if (!data.day) return <><Header title="Today" sub="Your plan for today." /><main class="page"><Empty art="rest" title="Your plan starts later">Open Plan to see your first study day.</Empty><button class="btn primary" onClick={() => go('plan')}>Open Plan</button></main></>
  const { day, due, streaks } = data
  const tasks = day.tasks
  const study = studyTasks(tasks)
  const planned = plannedMin(study), done = data.done_minutes ?? 0
  const exam = settings.data?.exam_date || data.date
  const dte = dayDiff(data.date, exam)
  const dow = new Date(data.date + 'T00:00:00Z').getUTCDay()
  const defCap = +(dow === 0 || dow === 6 ? settings.data?.weekend_study_minutes ?? 300 : settings.data?.weekday_study_minutes ?? 180)
  const cap = day.available_minutes ?? defCap
  const carried = tasks.filter((t) => t.carried_over_from).length
  const questionGoal = data.daily_question_goal ?? 30, questionsDone = data.questions_done ?? 0
  const goal = goalProgress(done, planned, questionsDone, questionGoal)
  const focus = pickFocus(tasks, data.date === todayFn() ? clock[0] * 60 + clock[1] : -1)
  const EYEBROW = { now: 'Now', late: 'Still to do', next: 'Up next', open: 'Up next' }
  const later = groupTasks(tasks).flatMap(([, ts]) => ts).filter((t) => !isGymTask(t) && t.id !== focus?.task.id)
  const gymTask = tasks.find(isGymTask)
  const toggleGym = async () => { const value = !checkin.data?.gym_done; try { await putCheckin(data.date, { gym_done: value }); checkin.reload(); reload(); toast(value ? 'Gym logged' : 'Gym undone') } catch (e: any) { toast(e.message) } }
  const sn = mastery.data?.study_next
  const suggestions: Suggestion[] = []
  if (reviewEnabled && due.cards > 0) suggestions.push({ key: 'cards', title: `Review ${due.cards} flashcard${due.cards === 1 ? '' : 's'}`, line: 'A few minutes now keeps them from fading.', cta: 'Review cards', run: () => go('cards/review') })
  if (practiceEnabled && due.mistakes > 0) suggestions.push({ key: 'mistakes', title: `Revise ${due.mistakes} mistake${due.mistakes === 1 ? '' : 's'}`, line: 'Questions you got wrong earlier, due again today.', cta: 'Revise', run: () => go('mistakes') })
  if (sn) suggestions.push({ key: 'study', title: `Learn: ${sn.atom_name}`, line: `${sn.topic_name} · ${sn.score}% mastered`, cta: 'Open concept', run: () => go(learnEnabled ? `learn/${sn.topic_id}/${sn.atom_id}` : `practice/${sn.topic_id}?atom=${sn.atom_id}`) })
  if (practiceEnabled) {
    suggestions.push({ key: 'mix', title: 'Quick test: 10 questions', line: 'Timed questions from your weaker chapters.', cta: 'Start test', run: () => begin('quick', { weak: true }, 10).catch((e) => toast(e.message)) })
    suggestions.push({ key: 'ga', title: 'Aptitude warm-up', line: 'Five quick General Aptitude questions.', cta: 'Start warm-up', run: () => begin('quick', { subject: 'ga' }, 5).catch((e) => toast(e.message)) })
    suggestions.push({ key: 'hours', title: 'Where to spend your next hours', line: 'Chapters ranked by marks you can still gain.', cta: 'See chapters', run: () => go('priority') })
  }
  const first = suggestions[0], others = suggestions.slice(1)
  const sub = `${fmtDate(data.date, { weekday: 'long', day: 'numeric', month: 'long' })}${dte >= 0 ? ` · ${dte} days to exam` : ''}`
  const showEvening = evening && data.date === todayFn() && !!checkin.data &&
    (checkin.data.sleep_hours == null || checkin.data.energy == null || checkin.data.mood == null)

  return (
    <>
      <Header title="Today" sub={sub} right={<button class="icon-btn" aria-label="Open calendar" onClick={() => go('calendar')}><Icon.cal /></button>} />
      <main class="page today">
        <div class="today-main">
          <StatLine streak={streaks?.study?.current ?? 0} done={!!streaks?.study?.today_done} cards={due.cards} review={reviewEnabled} />
          <GoalConfetti pct={goal.reached ? 1 : goal.combined} />
          {focus ? (
            <section class="focus" aria-label="Up next">
              <div class="eyebrow"><i aria-hidden="true" />{EYEBROW[focus.when]}{focus.range ? ` · ${focus.range}` : ''}</div>
              <h2><Md text={focus.task.title}/></h2>
              <div class="meta"><span>{fmtMin(focus.task.est_minutes)}</span>{focus.task.type && <span>{focus.task.fixed && focus.task.type === 'study' ? 'Routine' : TYPE_LABEL[focus.task.type] ?? focus.task.type}</span>}</div>
              <div class="btns">
                <button class="btn primary" onClick={() => startTask(focus.task).catch((e: any) => toast(e.message))}>Start</button>
                <button class="btn" onClick={() => toggle(focus.task)}><Icon.check size={20} /> Mark done</button>
                <button class="btn ghost" onClick={() => openMenu(focus.task)} aria-label="More options for this task">More</button>
              </div>
            </section>
          ) : tasks.some(t => !isGymTask(t)) ? (
            <section class="focus rest"><Art kind="trophy" /><div class="eyebrow"><i aria-hidden="true" />Done for today</div><h2>Everything planned is ticked off.</h2><div class="meta"><span>Rest, or pick something from Suggested for you.</span></div></section>
          ) : null}
          <section class="goal-card" aria-label="Daily goal">
            <GoalRings minutes={done} minuteGoal={planned} questions={questionsDone} questionGoal={questionGoal} />
            <div class="prog-t"><b>Daily goal</b><span>{fmtMin(done)} of {fmtMin(planned)} studied{questionGoal > 0 ? ` · ${questionsDone} of ${questionGoal} questions` : ''}</span>{goal.reached && <span>Goal reached. Nice work.</span>}</div>
          </section>
          {data.missed && !data.missed.undone && (data.missed.moved > 0 || data.missed.skipped > 0) && (
            <div class="note row between gap">
              <span>Missed days: {data.missed.moved} task{data.missed.moved === 1 ? '' : 's'} moved forward{data.missed.skipped ? `, ${data.missed.skipped} skipped` : ''}.</span>
              <button class="btn sm" onClick={() => undoRevision(data.missed!.revision_id).then(() => { toast('Reverted'); reload() }).catch((e) => toast(e.message))}>Undo</button>
            </div>
          )}
          {tasks.length === 0 && <Empty title="Nothing planned today">Take the day off, or add a task from the Plan tab.</Empty>}
          {later.length > 0 && (
            <section class="group" aria-label="Later today">
              <h2>{focus ? 'Later today' : 'Today’s tasks'} <small>{fmtMin(plannedMin(later))}</small></h2>
              <ul class="tasks">{later.map((t) => <TaskRow compact key={t.id} t={t} toggle={toggle} skip={skip} tomorrow={tomorrow} openMenu={openMenu} />)}</ul>
            </section>
          )}

          {(gymTask || carried > 0) && <section class="today-extras" aria-label="Other updates">
            {gymTask && <button class="routine-action" aria-pressed={!!checkin.data?.gym_done} onClick={toggleGym}><Icon.check size={18} /><span>{checkin.data?.gym_done ? 'Gym logged · undo' : 'Log gym'}<small>{gymTask.time_block?.replace('-', '–') || 'Today’s routine'}</small></span><Icon.chev size={18} /></button>}
            {carried > 0 && <p class="quiet-note">{carried} task{carried > 1 ? 's' : ''} carried over from earlier days.</p>}
          </section>}

          {showEvening && (
            <section class="card evening" aria-label="Evening check-in"><h2>How did today go?</h2><p class="muted">A 20-second check-in helps your plan fit your energy.</p><button class="btn" onClick={() => setCheckinOpen(true)}>Check in</button></section>
          )}
          {first && (
            <section class="card suggest" aria-label="Suggested for you">
              <small>Suggested for you</small>
              <h2>{first.title}</h2><p class="muted">{first.line}</p>
              <button class="btn" onClick={first.run}>{first.cta}</button>
              {others.length > 0 && <button class="btn link" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'See less' : 'See more'}</button>}
              {more && <ul class="list sug-more">{others.map((o) => <li><button class="lrow col" onClick={o.run}><b>{o.title}</b><small>{o.line}</small></button></li>)}</ul>}
            </section>
          )}
        </div>
      </main>
      {sheets}
      {checkinOpen && <QuickCheckIn date={data.date} jobsEnabled={modules.some(m => m.id === 'jobs' && m.enabled)} onClose={() => { setCheckinOpen(false); checkin.reload() }} />}
      {capOpen && <Capacity date={data.date} init={cap} onClose={() => setCapOpen(false)} onDone={() => { setCapOpen(false); reload() }} />}
    </>
  )
}

function GoalConfetti({ pct }: { pct: number }) {
  const prev = useRef<number | null>(null); const [fire, setFire] = useState(false)
  useEffect(() => { if (prev.current !== null && prev.current < 1 && pct >= 1) setFire(true); prev.current = pct }, [pct])
  return <Confetti fire={fire} />
}

function Capacity({ date, init, onClose, onDone }: { date: string; init: number; onClose: () => void; onDone: () => void }) {
  const [h, setH] = useState(init / 60); const [busy, setBusy] = useState(false)
  const apply = async () => {
    setBusy(true)
    try {
      const r: any = await setCapacity(date, Math.round(h * 60))
      if (isQueued(r)) toast('Saved offline. Plan will rescale when online')
      else toast(r?.changes?.length ? `${r.changes.length} task${r.changes.length > 1 ? 's' : ''} rescaled` : 'Capacity updated', r?.revision_id ? { label: 'Undo', run: () => undoRevision(r.revision_id).then(onDone).catch((e: any) => toast(e.message)) } : undefined)
      onDone()
    } catch (e: any) { toast(e.message); setBusy(false) }
  }
  return (
    <Sheet title="Time available today" onClose={onClose}>
      <p class="muted">Lower-priority tasks move to later days if you have less time, and come forward if you have more.</p>
      <div class="cap-pick">
        <Stepper value={h} onChange={setH} step={0.5} min={0} max={14} suffix="h" />
        <input type="range" min="0" max="12" step="0.5" value={h} aria-label="Hours" onInput={(e) => setH(+(e.target as HTMLInputElement).value)} />
      </div>
      <button class="btn primary block" disabled={busy} onClick={apply}>{busy ? 'Updating plan...' : 'Update today\'s plan'}</button>
    </Sheet>
  )
}
void todayFn

function QuickCheckIn({ date, jobsEnabled, onClose }: { date: string; jobsEnabled: boolean; onClose: () => void }) {
  const { data, loading, error, reload } = useLoad(() => getCheckin(date), [date])
  const subjects = useLoad(getSubjects, [])
  const [f, setF] = useState<any>(null)
  const [minutes, setMinutes] = useState<Record<string, number>>({})
  useEffect(() => { if (data) setF({ energy: data.energy ?? 3, mood: data.mood ?? 3, sleep_hours: data.sleep_hours ?? 7, gym_done: !!data.gym_done,
    job_applications: data.job_counts.applications, referrals_sent: data.job_counts.outreach, notes: data.notes ?? '' }) }, [data])
  const save = async () => { try { const { job_applications, referrals_sent, ...rest } = f; const r = await putCheckin(date, { ...rest, ...(jobsEnabled ? { job_applications, referrals_sent } : {}), ...(Object.keys(minutes).length ? { study_minutes: minutes } : {}) }); toast(isQueued(r) ? 'Saved offline' : 'Check-in saved'); onClose() } catch (e: any) { toast(e.message) } }
  return <Sheet title="Evening check-in" onClose={onClose}>{loading || !f ? <Loading error={error} retry={reload} /> : <>
    <p>{fmtMin(data?.study_minutes_total ?? 0)} study{jobsEnabled ? ` · ${fmtMin(data?.job_minutes ?? 0)} job time` : ''}</p>
    {Object.keys({ ...data?.auto_minutes, ...data?.manual_minutes }).map(id => <div class="srow"><span>{subjects.data?.find(s => s.id === id)?.name ?? id}</span><Stepper value={minutes[id] ?? data?.manual_minutes[id] ?? data?.auto_minutes[id]} step={15} onChange={v => setMinutes({ ...minutes, [id]: v })} /></div>)}
    {jobsEnabled && <><div class="srow"><span>Applications</span><Stepper value={f.job_applications} onChange={v => setF({ ...f, job_applications: v })} /></div>
    <div class="srow"><span>Outreach</span><Stepper value={f.referrals_sent} onChange={v => setF({ ...f, referrals_sent: v })} /></div></>}
    <label class="toggle"><span>Gym done</span><input type="checkbox" checked={f.gym_done} onChange={() => setF({ ...f, gym_done: !f.gym_done })} /><i /></label>
    <Field label="Sleep (hours)"><input type="number" min="0" max="24" step="0.5" value={f.sleep_hours} onInput={e => setF({ ...f, sleep_hours: +(e.target as HTMLInputElement).value })} /></Field>
    <Field label="Energy (1–5)"><input type="range" min="1" max="5" value={f.energy} onInput={e => setF({ ...f, energy: +(e.target as HTMLInputElement).value })} /><output>{f.energy} of 5</output></Field>
    <Field label="Mood (1–5)"><input type="range" min="1" max="5" value={f.mood} onInput={e => setF({ ...f, mood: +(e.target as HTMLInputElement).value })} /><output>{f.mood} of 5</output></Field>
    <Field label="Note"><textarea rows={2} value={f.notes} onInput={e => setF({ ...f, notes: (e.target as HTMLTextAreaElement).value })} /></Field>
    <button class="btn primary block" onClick={save}>Save check-in</button><button class="btn block" onClick={() => { onClose(); go('log') }}>Open full check-in</button></>}</Sheet>
}
