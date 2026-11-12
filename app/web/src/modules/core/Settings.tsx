import { useEffect, useState } from 'preact/hooks'
import { doLogout, getSettings, patchSettings, exportAll, getBank, isQueued, patchModule, getVapid, addPushSubscription, removePushSubscription } from '../../api'
import { Header, Loading, useLoad, Field, toast, Seg } from '../../ui'
import { useModules, refreshModules } from '../../modules'
import { usePrefs, setPrefs, getTheme, setTheme, type Prefs, type Theme } from '../../store'

const KEYS = ['gym_start', 'gym_end', 'weekday_study_minutes', 'weekend_study_minutes', 'daily_question_goal', 'exam_date'] as const

export default function Settings() {
  const { data, error, loading, reload } = useLoad(getSettings, [])
  const [f, setF] = useState<Record<string, string>>({})
  const [prog, setProg] = useState('')
  const vapid=useLoad(()=>getVapid().catch(()=>({enabled:false,public_key:null})),[])
  const [pushState,setPushState]=useState('')
  const [reminders,setReminders]=useState<Record<string,string>>({})
  const prefs = usePrefs()
  const modules = useModules()
  const enabled = (id: string) => modules.some(m => m.id === id && m.enabled)
  const ownerSchedule = data && !('routine_blocks' in data)
  const [theme, setThemeState] = useState<Theme>(getTheme())
  useEffect(() => { if (data) { setF({ gym_start: data.gym_start ?? '', gym_end: data.gym_end ?? '', weekday_study_minutes: String(data.weekday_study_minutes ?? 180),
    weekend_study_minutes: String(data.weekend_study_minutes ?? 300), daily_question_goal: String(data.daily_question_goal ?? 30), exam_date: data.exam_date ?? '', job_applications_target: String(data.job_applications_target ?? 2), job_outreach_target: String(data.job_outreach_target ?? 2) }); setReminders({score_target:data.score_target??'',reminder_morning:data.reminder_morning??'07:30',reminder_checkin:data.reminder_checkin??'21:30',reminder_mistakes:data.reminder_mistakes??'19:00',reminder_quiet_start:data.reminder_quiet_start??'22:00',reminder_quiet_end:data.reminder_quiet_end??'07:00',reminder_gym_mute:data.reminder_gym_mute??'1'}) } }, [data])
  if (loading || !data) return <><Header title="Settings" onBack menu={false} /><main class="page"><Loading error={error} retry={reload} /></main></>
  const s = (k: string) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value })
  const save = async () => {
    const body: Record<string, any> = {}
    for (const k of KEYS.filter(k => ownerSchedule || !k.startsWith('gym'))) body[k] = k.endsWith('minutes') || k === 'daily_question_goal' ? +f[k] : f[k]
    try { const r = await patchSettings(body); toast(isQueued(r) ? 'Saved offline' : 'Settings saved') } catch (e: any) { toast(e.message) }
  }
  const doExport = async () => {
    try {
      const j = await exportAll()
      const url = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a'); a.href = url; a.download = `gate27-export-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e: any) { toast(e.message || 'Export failed (are you online?)') }
  }
  const dlImages = async () => {
    const qs = await getBank(); const imgs = [...new Set(qs.flatMap((q) => q.images))]; let n = 0
    const worker = async () => { while (imgs.length) { const u = imgs.pop()!; try { await fetch(u) } catch { /* offline */ } setProg(`Downloading images... ${++n}/${n + imgs.length}`) } }
    await Promise.all([worker(), worker(), worker(), worker()]); setProg('Images saved for offline use'); 
  }
  return (
    <>
      <Header title="Settings" onBack menu={false} />
      <main class="page form settings-page">
        <p class="settings-intro">Make the app fit your schedule and study style.</p>
        {enabled('planner') && <section class="card">
          <h2>Schedule</h2>
          <div class="two">
            {ownerSchedule && <Field label="Gym starts"><input type="time" value={f.gym_start} onInput={s('gym_start')} /></Field>}
            {ownerSchedule && <Field label="Gym ends"><input type="time" value={f.gym_end} onInput={s('gym_end')} /></Field>}
            <Field label="Weekday study (min)"><input type="number" inputMode="numeric" step="15" value={f.weekday_study_minutes} onInput={s('weekday_study_minutes')} /></Field>
            <Field label="Weekend study (min)"><input type="number" inputMode="numeric" step="15" value={f.weekend_study_minutes} onInput={s('weekend_study_minutes')} /></Field>
            <Field label="Daily questions"><input type="number" inputMode="numeric" min="0" max="200" value={f.daily_question_goal} onInput={s('daily_question_goal')} /><small>0 turns this goal off.</small></Field>
          </div>
          <Field label="Exam date"><input type="date" value={f.exam_date} onInput={s('exam_date')} /></Field>
          <button class="btn primary block" onClick={save}>Save</button>
        </section>}
        <section class="card settings-feature">
          <h2>Appearance</h2>
          <Seg<Theme> value={theme} onChange={(v) => { setTheme(v); setThemeState(v) }} options={[["system", "System"], ["light", "Light"], ["dark", "Dark"]]} />
          <small class="muted">System follows your device setting.</small>
          <label class="toggle"><span>Haptics on answers</span><input type="checkbox" checked={prefs.haptics} onChange={() => setPrefs({ haptics: !prefs.haptics })} /><i /></label>
        </section>
        {(enabled('learn') || enabled('practice')) && <details class="settings-group">
          <summary>Reading and practice</summary>
          {enabled('learn') && <Seg<Prefs['detail']> value={prefs.detail} onChange={(v) => setPrefs({ detail: v })} options={[['focus', 'Focus'], ['full', 'Full']]} />}
          {enabled('learn') && <small class="muted">Focus shows short, one-idea chunks. Full shows the complete explanation. Every section also has its own Show more.</small>}
          {enabled('practice') && <label class="toggle"><span>Show questions outside the 2027 syllabus</span><input type="checkbox" checked={prefs.showOutside} onChange={() => setPrefs({ showOutside: !prefs.showOutside })} /><i /></label>}
          {enabled('practice') && <label class="toggle"><span>Include older papers (2000 to 2016)</span><input type="checkbox" checked={prefs.showPre2017} onChange={() => setPrefs({ showPre2017: !prefs.showPre2017 })} /><i /></label>}
          {enabled('practice') && <small class="muted">Older papers use community answers from GATE Overflow, not official keys.</small>}
        </details>}
        {enabled('jobs') && <details class="settings-group"><summary>Daily job target</summary><div class="two"><Field label="Applications"><input type="number" min="1" max="20" value={f.job_applications_target} onInput={s('job_applications_target')} /></Field><Field label="Outreach"><input type="number" min="1" max="20" value={f.job_outreach_target} onInput={s('job_outreach_target')} /></Field></div><button class="btn block" onClick={() => patchSettings({ job_applications_target: +f.job_applications_target, job_outreach_target: +f.job_outreach_target }).then(() => toast('Targets saved')).catch((e: any) => toast(e.message))}>Save targets</button></details>}
        <details class="settings-group"><summary>Mock score target</summary><Field label="Target marks"><input type="number" min="0" max="100" value={reminders.score_target??''} onInput={e=>setReminders({...reminders,score_target:(e.target as HTMLInputElement).value})}/></Field><button class="btn block" onClick={()=>patchSettings({score_target:reminders.score_target}).then(()=>toast('Target saved')).catch((e:any)=>toast(e.message))}>Save target</button></details>
        {enabled('habits') && <details class="settings-group"><summary>Reminders</summary><p class="muted">On iPhone, open this app from its Home Screen icon. In Safari, use Share → Add to Home Screen first. Then allow notifications below.</p>
          {vapid.data?.enabled?<button class="btn primary block" onClick={async()=>{try{if(!('serviceWorker'in navigator)||!('PushManager'in window)) throw new Error('Push is unavailable on this device');const permission=await Notification.requestPermission();if(permission!=='granted') throw new Error('Notifications were not allowed');const reg=await navigator.serviceWorker.ready;const key=Uint8Array.from(atob(vapid.data.public_key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});await addPushSubscription(sub.toJSON());setPushState('Reminders enabled')}catch(e:any){setPushState(e.message)}}}>Enable reminders</button>:<p class="muted">Reminders are unavailable until VAPID keys are configured on the server.</p>}
          {pushState&&<p role="status">{pushState}</p>}
          {(['reminder_morning','reminder_checkin','reminder_mistakes','reminder_quiet_start','reminder_quiet_end'] as const).map(k=><Field label={k.replace('reminder_','').replace('_',' ')}><input type="time" value={reminders[k]||''} onInput={e=>setReminders({...reminders,[k]:(e.target as HTMLInputElement).value})}/></Field>)}
          <label class="toggle"><span>Mute during gym time</span><input type="checkbox" checked={reminders.reminder_gym_mute!=='0'} onChange={e=>setReminders({...reminders,reminder_gym_mute:(e.target as HTMLInputElement).checked?'1':'0'})}/><i/></label>
          <button class="btn block" onClick={()=>patchSettings(reminders).then(()=>toast('Reminder schedule saved')).catch((e:any)=>toast(e.message))}>Save reminder times</button>
          <button class="btn sm" onClick={async()=>{try{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(sub){await removePushSubscription(sub.endpoint);await sub.unsubscribe()}setPushState('Reminders disabled')}catch(e:any){setPushState(e.message)}}}>Disable reminders</button>
        </details>}
        <details class="settings-group">
          <summary>My papers</summary>
          <Seg<Prefs['papers']> value={prefs.papers} onChange={(v) => setPrefs({ papers: v })} options={[['CS', 'CS'], ['DA', 'DA'], ['both', 'Both']]} />
          <small class="muted">Decides which past-paper marks per paper are shown on subjects and chapters.</small>
        </details>
        <details class="settings-group">
          <summary>Modules</summary>
          {modules.filter(m => m.available).map(m => <label class="toggle"><span>{m.id[0].toUpperCase() + m.id.slice(1)}</span><input type="checkbox" checked={m.enabled} onChange={async () => { try { await patchModule(m.id, !m.enabled); await refreshModules() } catch (e: any) { toast(e.message) } }} /><i /></label>)}
        </details>
        <details class="settings-group">
          <summary>Data and offline use</summary>
          <button class="btn block" onClick={doExport}>Export all data (JSON)</button>
          {enabled('practice') && <button class="btn block" onClick={dlImages}>Download question images for offline</button>}
          {prog && <small class="muted">{prog}</small>}
          {enabled('practice') && <small class="muted">Images are about 30 MB in total, so this is best done on Wi-Fi.</small>}
        </details>
        <details class="settings-group">
          <summary>Account</summary>
          {enabled('learn') && <a class="btn block" href="#/dev/anim">Animation gallery</a>}
          <button class="btn block danger" onClick={doLogout}>Sign out</button>
          <small class="muted">Version {__APP_VERSION__}. Install: in Safari use Share, then Add to Home Screen. In Chrome use Install app.</small>
        </details>
      </main>
    </>
  )
}
