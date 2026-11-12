import { useEffect, useState } from 'preact/hooks'
import { getJobs, addJob, patchJob, isQueued, getJobToday, logOutreach } from '../../api'
import { setJobActive } from '../../active-time'
import { useLoad, Loading, toast, Empty, Sheet, Field } from '../../ui'
import { today, cx, fmtDate } from '../../util'
const val = (e: Event) => (e.target as HTMLInputElement).value

const RESP = ['none', 'ack', 'screen', 'interview', 'offer', 'rejected']
export default function Jobs({ startTimer = false }: { startTimer?: boolean }) {
  const { data, error, loading, reload, set } = useLoad(getJobs, [])
  const activity = useLoad(getJobToday, [])
  const [form, setForm] = useState<any>(null)
  const [running, setRunning] = useState(startTimer), [seconds, setSeconds] = useState(0)
  useEffect(() => { setJobActive(running); if (!running) activity.reload(); return () => setJobActive(false) }, [running])
  useEffect(() => { if (!running) return; const id = setInterval(() => { if (document.visibilityState === 'visible') setSeconds(n => n + 1) }, 1000); return () => clearInterval(id) }, [running])
  useEffect(() => { const hide = () => { if (document.visibilityState === 'hidden') setRunning(false) }; document.addEventListener('visibilitychange', hide); return () => document.removeEventListener('visibilitychange', hide) }, [])
  if (loading || !data) return <Loading error={error} retry={reload} />
  const t = today()
  const due = (j: any) => j.next_follow_up && j.next_follow_up <= t && !['offer', 'rejected'].includes(j.response)
  const sorted = [...data].sort((a, b) => Number(!!due(b)) - Number(!!due(a)) || (b.date_applied ?? '').localeCompare(a.date_applied ?? ''))
  const save = async (j: any) => {
    const body = { company: j.company, role: j.role || null, url: j.url || null, date_applied: j.date_applied || null, person_contacted: j.person_contacted || null,
      response: j.response || 'none', next_follow_up: j.next_follow_up || null, notes: j.notes || null }
    try {
      const r = j.id ? await patchJob(j.id, body) : await addJob(body)
      if (j.id) set((d) => d && d.map((x) => (x.id === j.id ? { ...x, ...body } : x)))
      toast(isQueued(r) ? 'Saved offline' : 'Saved'); setForm(null); if (!j.id) reload(); activity.reload()
    } catch (e: any) { toast(e.message) }
  }
  return (
    <>
      <section class="card"><h2>Job time</h2><p class="muted">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} this session · {activity.data?.minutes ?? 0} min logged today</p>
        <div class="row gap"><button class="btn primary" onClick={() => setRunning(!running)}>{running ? 'Pause timer' : 'Start timer'}</button><button class="btn" onClick={() => { setRunning(false); setSeconds(0); activity.reload() }}>Stop</button></div></section>
      <section class="card"><h2>Today</h2><p>{activity.data?.applications ?? 0} applications · {activity.data?.outreach ?? 0} outreach</p>
        <button class="btn" onClick={() => logOutreach().then(() => { activity.reload(); toast('Outreach logged') }).catch((e: any) => toast(e.message))}>Log outreach</button></section>
      <div class="row between"><h2 class="h">Applications <small>{data.length}</small></h2><button class="btn sm primary" onClick={() => setForm({ date_applied: t, response: 'none' })}>Add job</button></div>
      {sorted.length === 0 && <Empty>No applications logged yet.</Empty>}
      <ul class="list card">{sorted.map((j) => (
        <li><button class={cx('lrow col', due(j) && 'due-now')} onClick={() => setForm(j)}>
          <div class="row between"><b>{j.company}</b><span class={'resp r-' + (j.response || 'none')}>{j.response || 'none'}</span></div>
          <small>{j.role}{j.date_applied ? ` - applied ${fmtDate(j.date_applied)}` : ''}</small>
          {j.next_follow_up && <small class={due(j) ? 'warnt' : 'muted'}>{due(j) ? 'Follow up due ' : 'Follow up '}{fmtDate(j.next_follow_up)}</small>}
        </button></li>))}
      </ul>
      {form && <JobForm init={form} onClose={() => setForm(null)} onSave={save} />}
    </>
  )
}
function JobForm({ init, onClose, onSave }: { init: any; onClose: () => void; onSave: (j: any) => void }) {
  const [f, setF] = useState<any>({ ...init })
  const s = (k: string) => (e: Event) => setF({ ...f, [k]: val(e) })
  return (
    <Sheet title={f.id ? 'Edit application' : 'Add application'} onClose={onClose}>
      <Field label="Company"><input value={f.company ?? ''} onInput={s('company')} autoFocus={!f.id} /></Field>
      <div class="two">
        <Field label="Role"><input value={f.role ?? ''} onInput={s('role')} /></Field>
        <Field label="Contact"><input value={f.person_contacted ?? ''} onInput={s('person_contacted')} /></Field>
      </div>
      <Field label="URL"><input type="url" inputMode="url" value={f.url ?? ''} onInput={s('url')} /></Field>
      <div class="two">
        <Field label="Date applied"><input type="date" value={f.date_applied ?? ''} onInput={s('date_applied')} /></Field>
        <Field label="Next follow-up"><input type="date" value={f.next_follow_up ?? ''} onInput={s('next_follow_up')} /></Field>
      </div>
      <Field label="Response"><select value={f.response ?? 'none'} onChange={s('response')}>{RESP.map((r) => <option>{r}</option>)}</select></Field>
      <Field label="Notes"><textarea rows={2} value={f.notes ?? ''} onInput={s('notes')} /></Field>
      <button class="btn primary block" disabled={!f.company?.trim()} onClick={() => onSave(f)}>Save</button>
    </Sheet>
  )
}
