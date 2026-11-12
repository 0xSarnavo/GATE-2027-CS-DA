import { useEffect, useState } from 'preact/hooks'
import { getDrill, postDrill, isQueued } from '../../api'
import { Header, Loading, Empty, useLoad, toast } from '../../ui'
import { Md } from '../../md'
import { go, useLayer } from '../../router'
import { Calculator } from '../test/Calculator'
export default function Drill() {
  const [duration,setDuration]=useState<60|120>(60), [started,setStarted]=useState(0), [remaining,setRemaining]=useState(0), [answers,setAnswers]=useState<Record<string,string>>({}),[result,setResult]=useState<any>(null),[calc,setCalc]=useState(false)
  const {data,error,loading,reload}=useLoad(()=>getDrill(duration),[duration])
  const finish=async()=>{ if(!started||result) return; setStarted(0); try { const r=await postDrill(duration,Object.entries(answers).map(([id,answer])=>({id,answer})));setResult(r); if(isQueued(r)) toast('Drill will be scored when you are back online') }catch(e:any){toast(e.message)} }
  useEffect(()=>{if(!started)return;const timer=setInterval(()=>{const left=Math.max(0,duration-Math.floor((Date.now()-started)/1000));setRemaining(left);if(left===0)finish()},250);return()=>clearInterval(timer)},[started,answers,result,duration])
  useLayer(calc,()=>setCalc(false))
  const begin=()=>{setAnswers({});setResult(null);setRemaining(duration);setStarted(Date.now())}
  return <><Header title="Speed drill" onBack={()=>go('practice')}/><main class="page"><p class="muted">NAT calculation questions, L2–L3. Use the virtual calculator and aim for your personal best.</p>
    <div class="chips"><button class={'chip '+(duration===60?'on':'')} disabled={!!started} onClick={()=>setDuration(60)}>60 seconds</button><button class={'chip '+(duration===120?'on':'')} disabled={!!started} onClick={()=>setDuration(120)}>120 seconds</button></div>
    {loading?<Loading error={error} retry={reload}/>: !data?.items?.length?<Empty art="empty" title="No drill questions">NAT questions at L2–L3 will appear here.</Empty>:<>
      <p><b>Personal best: {result?.best?.best_correct??data.best?.best_correct??0} correct</b></p>
      {!started&&!result&&<button class="btn primary block" onClick={begin}>Start drill</button>}
      {!!started&&<><div class="row between"><strong role="timer">{remaining}s left</strong><button class="btn sm" onClick={()=>setCalc(true)}>Calculator</button></div><ol class="list">{data.items.map((q:any)=><li class="card"><Md text={q.stem}/><label class="field"><span>Answer</span><input inputMode="decimal" value={answers[q.id]||''} onInput={e=>setAnswers({...answers,[q.id]:(e.target as HTMLInputElement).value})}/></label></li>)}</ol><button class="btn primary block" onClick={finish}>Finish</button></>}
      {result&&<section class="card"><h2>{isQueued(result)?'Waiting to score':`${result.correct} correct of ${result.attempted} attempted`}</h2><p>Best: {result.best?.best_correct??result.correct}</p><button class="btn primary" onClick={()=>{reload();setResult(null)}}>Try again</button></section>}
    </>}
  </main>{calc&&<div class="scrim" onClick={()=>setCalc(false)}><div onClick={e=>e.stopPropagation()}><Calculator onClose={()=>setCalc(false)}/></div></div>}</>
}
