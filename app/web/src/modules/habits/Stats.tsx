import { useState } from 'preact/hooks'
import { useModules } from '../index'
import { getStats, getStreaks, getTopics, getSettings, getPeriodAnalytics, getEnergyAnalytics, getScores } from '../../api'
import { Header, Loading, useLoad } from '../../ui'
import { PairBars, Lines, HBars } from '../../charts'
import { dayDiff, fmtMin, today } from '../../util'

const num = (p: any): number => (typeof p === 'number' ? p : p?.score ?? p?.raw_score ?? p?.y ?? 0)

export default function Stats() {
  const [period,setPeriod] = useState<'weekly'|'monthly'>('weekly')
  const periodData=useLoad(()=>getPeriodAnalytics(period).catch(()=>null),[period])
  const energy=useLoad(()=>getEnergyAnalytics().catch(()=>null),[])
  const scores=useLoad(()=>getScores().catch(()=>null),[])
  const modules = useModules()
  const jobsEnabled = modules.some(m => m.id === 'jobs' && m.enabled)
  const mocksEnabled = modules.some(m => m.id === 'mocks' && m.enabled)
  const { data, error, loading, reload } = useLoad(async () => {
    const [s, st, tp, settings] = await Promise.all([getStats().catch(() => ({})), getStreaks().catch(() => ({})), getTopics().catch(() => []), getSettings().catch(() => ({}))])
    return { s: s as any, st: st as any, tp, settings }
  }, [])
  if (loading || !data) return <><Header title="Stats" onBack /><main class="page"><Loading error={error} retry={reload} /></main></>
  const { s, st, tp, settings } = data
  const tname = (id: string) => tp.find((t) => t.id === id)?.name ?? id
  const weeks = (s.plan_adherence?.by_week ?? []).map((w: any, i: number) => ({
    label: w.label ?? (w.week_no ? 'W' + w.week_no : w.start_date ? w.start_date.slice(5) : 'W' + (i + 1)),
    planned: w.planned_min ?? w.planned ?? 0, done: w.done_min ?? w.done ?? 0 }))
  const acc = (s.accuracy_by_topic ?? []).map((a: any) => ({
    label: a.name ?? tname(a.topic_id), n: a.attempts ?? a.total ?? 0,
    pct: a.accuracy != null ? (a.accuracy > 1 ? a.accuracy / 100 : a.accuracy) : a.accuracy_percent != null ? a.accuracy_percent / 100 : (a.correct ?? 0) / Math.max(1, a.attempts ?? a.total ?? 1) }))
    .filter((a: any) => a.n > 0 || a.pct > 0).sort((a: any, b: any) => a.pct - b.pct).slice(0, 14)
  const trend = ['CS', 'DA'].map((p) => ({ name: p, cls: 's-' + p, pts: ((s.mock_trend?.[p] ?? []) as any[]).map(num) }))
  const dte = s.days_to_exam ?? dayDiff(today(), (settings as Record<string, any>).exam_date ?? today())
  return (
    <>
      <Header title="Stats" onBack />
      <main class="page">
        <section class="card streak-grid">
          {(['study', 'gym', 'revision', 'job'] as const).filter(k => k === 'job' ? jobsEnabled : k === 'gym' ? !('routine_blocks' in settings) || String(settings.routine_blocks).toLowerCase().includes('gym') : true).map((k) => (
            <div class={'sbox' + (st?.[k]?.today_done ? ' on' : '')}><b>{st?.[k]?.current ?? 0}</b><span>{k}</span><small>best {st?.[k]?.longest ?? 0}</small></div>
          ))}
        </section>
        <div class="muted center">{dte} days to exam{s.plan_adherence ? ` - ${fmtMin(s.plan_adherence.done_min ?? 0)} done of ${fmtMin(s.plan_adherence.planned_min ?? 0)} planned` : ''}</div>
        <section class="card">
          <h2>Planned vs done <small class="legend"><i class="lg plan" />planned <i class="lg done" />done</small></h2>
          {weeks.length ? <PairBars data={weeks} /> : <p class="muted">Not enough data yet.</p>}
        </section>
        <section class="card"><h2>Accuracy by topic</h2>{acc.length ? <HBars rows={acc.map((a: any) => ({ label: a.label, pct: a.pct, note: `(${a.n})` }))} /> : <p class="muted">Attempt some questions to see this.</p>}</section>
        <details class="stats-details">
          <summary>More analysis</summary>
        <div class="chips"><button class={'chip '+(period==='weekly'?'on':'')} onClick={()=>setPeriod('weekly')}>This week</button><button class={'chip '+(period==='monthly'?'on':'')} onClick={()=>setPeriod('monthly')}>This month</button></div>
        <section class="card"><h2>{period==='weekly'?'Weekly':'Monthly'} review</h2>
          {periodData.data ? <><p><b>{Math.round(periodData.data.plan_adherence*100)}%</b> plan adherence · <b>{periodData.data.study_days}</b> study days</p>
            <h3>Hours by subject</h3><PairBars data={(periodData.data.hours??[]).filter((x:any)=>x.subject_id).map((x:any)=>({label:x.subject_id,planned:x.planned_min??0,done:x.done_min??0}))}/>
            <h3>Questions and accuracy</h3>{(periodData.data.accuracy??[]).length>0&&<Lines series={[{name:'Accuracy',cls:'s-CS',pts:periodData.data.accuracy.map((x:any)=>Math.round(100*x.correct/x.attempted))}]} />}
            <ul class="list">{(periodData.data.accuracy??[]).map((x:any)=><li class="lrow">{x.date}: {x.attempted} attempted · {Math.round(100*x.correct/x.attempted)}% right</li>)}</ul>
            <p>Mastery gained: {(periodData.data.mastery??[]).reduce((n:number,x:any)=>n+Math.max(0,x.gained),0)} points across concepts</p>
            <p>Best: {(periodData.data.best_chapters??[]).map((x:any)=>x.name).join(', ')||'—'}</p><p>Needs work: {(periodData.data.worst_chapters??[]).map((x:any)=>x.name).join(', ')||'—'}</p></> : <p class="muted">No period data yet.</p>}
        </section>
        <section class="card"><h2>Energy and performance</h2>
          {energy.data?.items?.length ? <><small>Accuracy grouped by check-in and attempt time</small>
            <h3>Sleep hours</h3><HBars rows={energyBars(energy.data.items,(x:any)=>x.sleep_hours==null?'Unlogged':`${Math.floor(x.sleep_hours)}h`)}/>
            <h3>Energy</h3><HBars rows={energyBars(energy.data.items,(x:any)=>x.energy==null?'Unlogged':`${x.energy}/5`)}/>
            <h3>Time of day</h3><HBars rows={energyBars(energy.data.items,(x:any)=>x.hour<12?'Morning':x.hour<17?'Afternoon':'Evening')}/></> : <p class="muted">Log a check-in and answer questions to see the pattern.</p>}
        </section>
        {mocksEnabled && <section class="card"><h2>Score tracker</h2>
          {scores.data?.mocks?.length ? ['CS','DA'].map(p=>{const points=scores.data.mocks.filter((x:any)=>x.paper===p),cutoffs=(scores.data.cutoff_points??[]).filter((x:any)=>x.paper===p); if(!points.length)return null;const lines=[{name:p,cls:'s-'+p,pts:points.map((x:any)=>x.raw_score)}];if(scores.data.target)lines.push({name:'Target',cls:'s-target',pts:points.map(()=>scores.data.target)});if(cutoffs.length)lines.push({name:'Qualifying cutoff estimate',cls:'s-cutoff',pts:points.map((x:any)=>{const year=Number(x.date.slice(0,4));return (cutoffs.find((c:any)=>c.year===year)??cutoffs.at(-1)).score})});return <div><h3>{p}</h3><Lines series={lines}/><small>{points.map((x:any)=>x.date).join(' · ')}</small></div>}) : <p class="muted">Take or log a mock to see your score trend.</p>}
          {scores.data?.target && <p>Target: {scores.data.target} marks</p>}
          {scores.data?.cutoffs ? <><p class="muted">Qualifying cutoffs and programme data are estimates, not admission guarantees.</p>
            {(scores.data.cutoff_points??[]).length>0&&<ul class="list">{scores.data.cutoff_points.map((x:any)=><li class="lrow">{x.paper} {x.year} · {x.category}: {x.score} marks</li>)}</ul>}
            {Array.isArray(scores.data.cutoffs.programmes??scores.data.cutoffs.target_programmes)&&<details><summary>Programme estimates</summary><ul class="list">{(scores.data.cutoffs.programmes??scores.data.cutoffs.target_programmes).map((x:any)=><li class="lrow">{x.name??x.programme??x.institute??'Programme'} · {x.year??''} {x.score??x.cutoff??''}</li>)}</ul></details>}
          </> : <p class="muted">Past cutoff estimates are not available yet.</p>}
        </section>}
        </details>
        {mocksEnabled && <section class="card">
          <h2>Mock scores <small class="legend"><i class="lg s-CS" />CS <i class="lg s-DA" />DA</small></h2>
          {trend.some((t) => t.pts.length) ? <Lines series={trend} /> : <p class="muted">Log a mock in Log, Mocks.</p>}
        </section>}
      </main>
    </>
  )
}

function energyBars(rows:any[],key:(x:any)=>string) { const groups=new Map<string,{n:number;correct:number}>(); for(const x of rows){const k=key(x),g=groups.get(k)??{n:0,correct:0};g.n+=x.attempts;g.correct+=x.correct;groups.set(k,g)} return [...groups].map(([label,g])=>({label,pct:g.n?g.correct/g.n:0,note:`(${g.n})`})) }
