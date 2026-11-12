import { useState } from 'preact/hooks'
import { addTask, getPriority, isQueued } from '../../api'
import { Header, Loading, Empty, useLoad, toast } from '../../ui'
import { go } from '../../router'
import { addDays, today } from '../../util'
import { usePrefs } from '../../store'
export default function Priority() {
  const {papers}=usePrefs(), [paper,setPaper]=useState<'CS'|'DA'>(papers==='DA'?'DA':'CS')
  const {data,error,loading,reload}=useLoad(()=>getPriority(paper),[paper])
  const add=async (x:any) => { try { const r=await addTask({date:addDays(today(),1),title:`Practise ${x.name}`,type:'pyq',topic_id:x.topic_id,subject_id:x.subject_id,est_minutes:Math.round(x.hours_remaining*60),priority:1}); toast(isQueued(r)?'Saved offline':'Added to tomorrow’s plan') } catch(e:any){toast(e.message)} }
  return <><Header title="Best next hours" onBack={()=>go('practice')}/><main class="page">
    <p class="muted">Expected marks gained per hour from past paper weightage, your accuracy and estimated time left.</p>
    <div class="chips"><button class={'chip '+(paper==='CS'?'on':'')} onClick={()=>setPaper('CS')}>CS</button><button class={'chip '+(paper==='DA'?'on':'')} onClick={()=>setPaper('DA')}>DA</button></div>
    {loading?<Loading error={error} retry={reload}/>: !data?.items?.length?<Empty art="empty" title="No priorities yet">Add weightage data and chapters to see them ranked.</Empty>:<ol class="list">{data.items.slice(0,30).map((x:any)=><li class="card priority-row"><div class="row between"><b>{x.name}</b><strong>{x.expected_gain.toFixed(1)} marks/hour</strong></div><small>{Math.round(x.accuracy*100)}% accuracy · {x.hours_remaining.toFixed(1)} hours left · {x.subject_weight} subject marks</small><div class="row gap"><button class="btn sm primary" onClick={()=>go('practice/'+x.topic_id)}>Practise</button><button class="btn sm" onClick={()=>add(x)}>Add to plan</button></div></li>)}</ol>}
  </main></>
}
