import { useState } from 'preact/hooks'
import { getDoubts, getReports, patchDoubt, patchReport } from '../../api'
import { Header, Loading, Empty, useLoad, toast } from '../../ui'
import { Md } from '../../md'
import { go } from '../../router'

export default function Insights({parts=[]}:{parts?:string[]}) {
  return parts[0]==='reports' ? <Reports /> : <Doubts />
}
function Doubts() {
  const {data,error,loading,reload}=useLoad(getDoubts,[])
  return <><Header title="Doubts" onBack={() => go('cards')} /><main class="page">
    {loading?<Loading error={error} retry={reload}/>: !data?.items?.length?<Empty art="empty" title="No doubts yet">Use Doubt on a question, concept or chapter.</Empty>:<ul class="list">{data.items.map((d:any) => <li class="card">
      <div class="row between"><b>{d.ref_type}: {d.ref_id}</b>{d.status==='answered'&&!d.read_at?<span class="tag">New answer</span>:<span class="tag">{d.status}</span>}</div>
      <Md text={d.note}/>{d.answer_md&&<Md text={d.answer_md}/ >}
      {d.answer_md&&!d.read_at&&<button class="btn sm" onClick={async()=>{try {await patchDoubt(d.id,{read:true});reload()} catch(e:any){toast(e.message)}}}>Mark read</button>}
    </li>)}</ul>}
  </main></>
}
function Reports() {
  const {data,error,loading,reload}=useLoad(getReports,[])
  const [open,setOpen]=useState<string|null>(null)
  return <><Header title="Reports" onBack={() => go('today')} /><main class="page">
    {loading?<Loading error={error} retry={reload}/>: !data?.items?.length?<Empty art="empty" title="No reports yet">Daily, weekly and monthly reports will appear here.</Empty>:<ul class="list">{data.items.map((r:any) => <li class="card">
      <button class="lrow" aria-expanded={open===r.id} onClick={async()=>{setOpen(open===r.id?null:r.id);if(!r.read_at){try{await patchReport(r.id,true);reload()}catch(e:any){toast(e.message)}}}}><span class="grow"><b><Md text={r.title}/></b><small>{r.kind} · {r.period_start} to {r.period_end}</small></span>{!r.read_at&&<span class="tag">Unread</span>}</button>
      {open===r.id&&<Md text={r.body_md}/ >}
    </li>)}</ul>}
  </main></>
}
