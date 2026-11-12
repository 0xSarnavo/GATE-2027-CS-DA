import { lazy, Suspense } from 'preact/compat'
import { useEffect, useState } from 'preact/hooks'
import { getCheckin, getCheckins, putCheckin, getSubjects, getMocks, addMock, isQueued } from '../../api'
import { Header, Loading, useLoad, Seg, Field, Stepper, toast, Sheet, Empty } from '../../ui'
import { go } from '../../router'
import { useModules } from '../../modules'
import { Lines } from '../../charts'
import { addDays, cx, fmtDate, fmtMin, today } from '../../util'
import { Md } from '../../md'

const Jobs = lazy(() => import('../jobs/Jobs'))

type Tab = 'checkin' | 'mocks' | 'jobs' | 'history'
export default function Log({ tab }: { tab?: string }) {
  const modules = useModules()
  const jobsEnabled = modules.some(m => m.id === 'jobs' && m.enabled)
  const mocksEnabled = modules.some(m => m.id === 'mocks' && m.enabled)
  const t = (tab === 'jobs' && !jobsEnabled || tab === 'mocks' && !mocksEnabled ? 'checkin' : ['checkin', 'mocks', 'jobs', 'history'].includes(tab || '') ? tab : 'checkin') as Tab
  return (
    <>
      <Header title="Log" sub="Record what you did and how you felt." />
      <main class="page">
        <Seg<Tab> value={t} onChange={(v) => go('log/' + v, true)} options={[['checkin', 'Check-in'], ...(mocksEnabled ? [['mocks', 'Mocks'] as [Tab, string]] : []), ...(jobsEnabled ? [['jobs', 'Jobs'] as [Tab, string]] : []), ['history', 'History']]} />
        {t === 'checkin' && <CheckIn jobsEnabled={jobsEnabled} />}
        {t === 'mocks' && mocksEnabled && <Mocks />}
        {t === 'jobs' && jobsEnabled && <Suspense fallback={<Loading />}><Jobs startTimer={new URLSearchParams(location.hash.split('?')[1] || '').get('start') === '1'} /></Suspense>}
        {t === 'history' && <History jobsEnabled={jobsEnabled} />}
      </main>
    </>
  )
}

const val = (e: Event) => (e.target as HTMLInputElement).value
function Scale({ value, onChange, label }: { value: number | null; onChange: (n: number) => void; label: string }) {
  return (
    <div class="field"><span>{label}</span>
      <div class="scale" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => <button type="button" role="radio" aria-checked={value === n} class={cx(value === n && 'on')} onClick={() => onChange(n)}>{n}</button>)}
      </div>
    </div>
  )
}

function CheckIn({ jobsEnabled }: { jobsEnabled: boolean }) {
  const d = today()
  const { data, error, loading, reload } = useLoad(async () => {
    const [ci, subjects] = await Promise.all([getCheckin(d).catch(() => null), getSubjects().catch(() => [])])
    return { ci, subjects }
  }, [])
  const [f, setF] = useState<any>(null)
  const subjects = data?.subjects ?? []
  useEffect(() => {
    if (!data) return
    setF({ gym_done: !!data.ci?.gym_done, sleep_hours: data.ci?.sleep_hours ?? 7, mood: data.ci?.mood ?? null, energy: data.ci?.energy ?? null,
      job_applications: data.ci?.job_counts.applications ?? 0, referrals_sent: data.ci?.job_counts.outreach ?? 0,
      revision_done: !!data.ci?.revision_done, notes: data.ci?.notes ?? '', study_minutes: { ...(data.ci?.manual_minutes ?? {}) } })
  }, [data])
  if (loading || !f) return <Loading error={error} retry={reload} />
  const set = (p: object) => setF({ ...f, ...p })
  const sm = f.study_minutes as Record<string, number>
  const auto = (data!.ci?.auto_minutes ?? {}) as Record<string, number>
  const total = Object.keys({ ...auto, ...sm }).reduce((n, id) => n + (sm[id] ?? auto[id] ?? 0), 0)
  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? id
  const save = async () => {
    const body = { ...f, study_minutes: { ...Object.fromEntries(Object.keys(data!.ci?.manual_minutes ?? {}).map((k) => [k, 0])), ...sm } }
    try { const r = await putCheckin(d, body); toast(isQueued(r) ? 'Saved offline, will sync' : 'Check-in saved') } catch (e: any) { toast(e.message) }
  }
  return (
    <div class="form">
      <section class="card">
        <h2>Study today <small>{fmtMin(total)}</small></h2>
        {Object.keys(auto).length > 0 && (
          <>
            <small class="muted">Counted from active study, practice or tasks. Edit a subject to override it.</small>
          </>
        )}
        {Object.keys({ ...auto, ...sm }).map((id) => (
          <div class="srow"><span>{name(id)}{sm[id] == null && <small> · automatic</small>}</span><Stepper value={sm[id] ?? auto[id]} step={15} onChange={(v) => { const n = { ...sm, [id]: v }; if (!v) delete n[id]; set({ study_minutes: n }) }} /></div>
        ))}
        <select aria-label="Add subject" value="" onChange={(e) => { const id = val(e); if (id) set({ study_minutes: { ...sm, [id]: 30 } }) }}>
          <option value="">+ Add subject</option>{subjects.filter((s) => !(s.id in sm)).map((s) => <option value={s.id}>{s.name}</option>)}
        </select>
      </section>
      <details class="log-details">
        <summary>Routine and sleep <span>Optional</span></summary>
        <label class="toggle"><span>Gym done</span><input type="checkbox" checked={f.gym_done} onChange={() => set({ gym_done: !f.gym_done })} /><i /></label>
        <label class="toggle"><span>Revision done</span><input type="checkbox" checked={f.revision_done} onChange={() => set({ revision_done: !f.revision_done })} /><i /></label>
        <div class="srow"><span>Sleep (hours)</span><Stepper value={f.sleep_hours} step={0.5} max={14} onChange={(v) => set({ sleep_hours: v })} /></div>
        {jobsEnabled && <><div class="srow"><span>Job time</span><b>{fmtMin(data?.ci?.job_minutes ?? 0)}</b></div><div class="srow"><span>Job applications</span><Stepper value={f.job_applications} onChange={(v) => set({ job_applications: v })} /></div><div class="srow"><span>Outreach</span><Stepper value={f.referrals_sent} onChange={(v) => set({ referrals_sent: v })} /></div></>}
      </details>
      <details class="log-details"><summary>Energy and mood <span>Optional</span></summary><Scale label="Energy" value={f.energy} onChange={(n) => set({ energy: n })} /><Scale label="Mood" value={f.mood} onChange={(n) => set({ mood: n })} /></details>
      <Field label="Notes"><textarea rows={3} value={f.notes} onInput={(e) => set({ notes: val(e) })} placeholder="How did the day go?" /></Field>
      <button class="btn primary block" onClick={save}>Save check-in</button>
    </div>
  )
}

function Mocks() {
  const { data, error, loading, reload } = useLoad(getMocks, [])
  const [adding, setAdding] = useState(false)
  if (loading || !data) return <Loading error={error} retry={reload} />
  const sorted = [...data].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const series = (['CS', 'DA'] as const).map((p) => ({ name: p, cls: 's-' + p, pts: data.filter((m) => m.paper === p).sort((a, b) => a.date.localeCompare(b.date)).map((m) => (m.raw_score / (m.max_score || 100)) * 100) }))
  return (
    <>
      {series.some((s) => s.pts.length) && (
        <section class="card"><h2>Trend <small class="legend"><i class="lg s-CS" />CS <i class="lg s-DA" />DA</small></h2><Lines series={series} /></section>
      )}
      <div class="row between"><h2 class="h">Papers</h2><button class="btn sm primary" onClick={() => setAdding(true)}>Add attempt</button></div>
      {sorted.length === 0 && <Empty>No mock attempts logged yet.</Empty>}
      <ul class="list card">{sorted.map((m) => (
        <li class="lrow col">
          <div class="row between"><b><Md text={m.label || `${m.paper} ${m.year ?? ''} ${m.session ?? ''}`}/></b><b>{m.raw_score ?? '-'}<small>/{m.max_score ?? 100}</small></b></div>
          <small>{fmtDate(m.date)}{m.accuracy_percent != null ? ` - accuracy ${m.accuracy_percent}%` : ''}{m.attempted_marks != null ? ` - attempted ${m.attempted_marks}` : ''}{m.time_issue ? ` - ${m.time_issue}` : ''}</small>
          {m.notes && <small class="muted"><Md text={m.notes}/></small>}
        </li>))}
      </ul>
      {adding && <MockForm onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload() }} />}
    </>
  )
}
function MockForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ date: today(), paper: 'CS', year: '', session: '', raw_score: '', attempted_marks: '', accuracy_percent: '', time_issue: '', t1: '', t2: '', t3: '', notes: '' })
  const s = (k: string) => (e: Event) => setF({ ...f, [k]: val(e) })
  const save = async () => {
    const n = (v: string) => (v === '' ? null : +v)
    const body = { date: f.date, paper: f.paper, year: n(f.year), session: f.session || null, raw_score: n(f.raw_score), max_score: 100, attempted_marks: n(f.attempted_marks),
      accuracy_percent: n(f.accuracy_percent), time_issue: f.time_issue || null, topics_to_revise: [f.t1, f.t2, f.t3].filter(Boolean), notes: f.notes || null,
      label: `${f.paper} ${f.year} ${f.session}`.trim() }
    try { const r = await addMock(body); toast(isQueued(r) ? 'Saved offline' : 'Mock logged'); onDone() } catch (e: any) { toast(e.message) }
  }
  return (
    <Sheet title="Add paper attempt" onClose={onClose}>
      <div class="two">
        <Field label="Paper"><select value={f.paper} onChange={s('paper')}>{['CS', 'DA', 'GA', 'sectional'].map((p) => <option>{p}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onInput={s('date')} /></Field>
        <Field label="Year"><input type="number" inputMode="numeric" value={f.year} onInput={s('year')} placeholder="2024" /></Field>
        <Field label="Session"><input value={f.session} onInput={s('session')} placeholder="S1" /></Field>
        <Field label="Score /100"><input type="number" inputMode="decimal" value={f.raw_score} onInput={s('raw_score')} /></Field>
        <Field label="Attempted marks"><input type="number" inputMode="decimal" value={f.attempted_marks} onInput={s('attempted_marks')} /></Field>
        <Field label="Accuracy %"><input type="number" inputMode="decimal" value={f.accuracy_percent} onInput={s('accuracy_percent')} /></Field>
        <Field label="Time issue"><select value={f.time_issue} onChange={s('time_issue')}><option value="">None</option><option value="ran out">Ran out of time</option><option value="slow start">Slow start</option><option value="rushed end">Rushed end</option></select></Field>
      </div>
      <Field label="3 topics to revise"><input value={f.t1} onInput={s('t1')} /><input value={f.t2} onInput={s('t2')} /><input value={f.t3} onInput={s('t3')} /></Field>
      <Field label="Notes"><textarea rows={2} value={f.notes} onInput={s('notes')} /></Field>
      <button class="btn primary block" disabled={f.raw_score === ''} onClick={save}>Save</button>
    </Sheet>
  )
}

function History({ jobsEnabled }: { jobsEnabled: boolean }) {
  const t = today()
  const { data, error, loading, reload } = useLoad(() => getCheckins(addDays(t, -45), t), [])
  if (loading || !data) return <Loading error={error} retry={reload} />
  const rows = [...data].sort((a, b) => b.date.localeCompare(a.date))
  if (!rows.length) return <Empty>No check-ins yet. Your past days will show up here.</Empty>
  return (
    <ul class="list card">{rows.map((c) => {
      const sm = c.study_minutes_total ?? null
      return (
        <li class="lrow col">
          <div class="row between"><b>{fmtDate(c.date)}</b><small>{sm != null ? fmtMin(sm) + ' study' : ''}</small></div>
          <div class="row wrap gap">
            {c.gym_done ? <span class="tag">gym</span> : null}{c.sleep_hours != null && <span class="tag">sleep {c.sleep_hours}h</span>}
            {c.energy != null && <span class="tag">energy {c.energy}</span>}{c.mood != null && <span class="tag">mood {c.mood}</span>}
            {jobsEnabled && c.job_applications ? <span class="tag">{c.job_applications} apps</span> : null}
          </div>
          {c.notes && <small class="muted"><Md text={c.notes}/></small>}
        </li>)
    })}</ul>
  )
}
