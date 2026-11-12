import { useState } from 'preact/hooks'
import { setupPlan, ApiError } from '../../api'
import { Field, Logo } from '../../ui'
import { addDays, today } from '../../util'
import { useModules, refreshModules } from '../../modules'

type Block = { label: string; days: number[]; start: string; end: string }
export default function Onboarding({ done }: { done: () => void }) {
  const modules = useModules()
  const [step, setStep] = useState(0)
  const [papers, setPapers] = useState<'CS'|'DA'|'both'>('both')
  const [startDate, setStart] = useState(today())
  const [examDate, setExam] = useState(() => {
    let year = new Date().getFullYear()
    const firstSaturday = (y: number) => { const first = new Date(Date.UTC(y, 1, 1)); return addDays(`${y}-02-01`, (6 - first.getUTCDay() + 7) % 7) }
    if (firstSaturday(year) <= today()) year++
    return firstSaturday(year)
  })
  const [weekdayHours, setWeekday] = useState(3)
  const [weekendHours, setWeekend] = useState(5)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [breaks, setBreaks] = useState<{start:string;end:string}[]>([])
  const [selected, setSelected] = useState<string[]>(modules.filter(m => m.enabled && m.id !== 'jobs').map(m => m.id))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const submit = async () => {
    setBusy(true); setError('')
    try {
      await setupPlan({ papers, startDate, examDate, weekdayHours, weekendHours, routineBlocks: blocks.filter(b => b.label.trim()),
        breaks: breaks.filter(b => b.start && b.end), modules: selected })
      await refreshModules(); done()
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not create your plan. Check your connection and try again.') }
    finally { setBusy(false) }
  }
  return <main class="onboarding page form">
    <Logo size={64} /><h1>Make your study plan</h1><p class="muted">Step {step + 1} of 4</p>
    {step === 0 && <section class="card"><h2>Which papers?</h2><div class="seg" role="group" aria-label="GATE papers">{(['CS','DA','both'] as const).map(p => <button aria-pressed={papers === p} class={papers === p ? 'on' : ''} onClick={() => setPapers(p)}>{p === 'both' ? 'Both' : p}</button>)}</div></section>}
    {step === 1 && <section class="card"><h2>Dates and study time</h2><Field label="Start date"><input type="date" value={startDate} onInput={e => setStart((e.target as HTMLInputElement).value)} /></Field><Field label="Exam date"><input type="date" min={addDays(startDate, 1)} value={examDate} onInput={e => setExam((e.target as HTMLInputElement).value)} /></Field><Field label="Weekday hours"><input type="number" min="0" max="16" step="0.5" value={weekdayHours} onInput={e => setWeekday(+(e.target as HTMLInputElement).value)} /></Field><Field label="Weekend hours"><input type="number" min="0" max="16" step="0.5" value={weekendHours} onInput={e => setWeekend(+(e.target as HTMLInputElement).value)} /></Field></section>}
    {step === 2 && <section class="card"><h2>Routine and breaks</h2><p class="muted">Optional fixed blocks, such as work or college.</p>{blocks.map((b, i) => <div class="routine-block" key={i}><Field label="Block label"><input value={b.label} onInput={e => setBlocks(blocks.map((x,j) => j === i ? {...x,label:(e.target as HTMLInputElement).value} : x))} /></Field><div class="two"><Field label="Start"><input type="time" value={b.start} onInput={e => setBlocks(blocks.map((x,j) => j === i ? {...x,start:(e.target as HTMLInputElement).value} : x))} /></Field><Field label="End"><input type="time" value={b.end} onInput={e => setBlocks(blocks.map((x,j) => j === i ? {...x,end:(e.target as HTMLInputElement).value} : x))} /></Field></div><div class="chips" role="group" aria-label="Days for block">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((label, d) => <button class={'chip' + (b.days.includes(d) ? ' on' : '')} aria-pressed={b.days.includes(d)} onClick={() => setBlocks(blocks.map((x,j) => j === i ? {...x,days: b.days.includes(d) ? b.days.filter(v => v !== d) : [...b.days,d]} : x))}>{label}</button>)}</div><button class="btn sm" onClick={() => setBlocks(blocks.filter((_,j) => j !== i))}>Remove block</button></div>)}<button class="btn block" onClick={() => setBlocks([...blocks,{label:'',days:[1,2,3,4,5],start:'09:00',end:'17:00'}])}>Add routine block</button>{breaks.map((b, i) => <div class="two"><Field label="Break starts"><input type="date" value={b.start} onInput={e => setBreaks(breaks.map((x,j) => j === i ? {...x,start:(e.target as HTMLInputElement).value} : x))} /></Field><Field label="Break ends"><input type="date" min={b.start} value={b.end} onInput={e => setBreaks(breaks.map((x,j) => j === i ? {...x,end:(e.target as HTMLInputElement).value} : x))} /></Field><button class="btn sm" onClick={() => setBreaks(breaks.filter((_,j) => j !== i))}>Remove break</button></div>)}<button class="btn block" onClick={() => setBreaks([...breaks,{start:'',end:''}])}>Add break period</button></section>}
    {step === 3 && <section class="card"><h2>Modules</h2><p class="muted">Choose the tools you want. You can change these in Settings.</p>{modules.filter(m => m.available).map(m => <label class="toggle"><span>{m.id[0].toUpperCase() + m.id.slice(1)}</span><input type="checkbox" checked={selected.includes(m.id)} onChange={() => setSelected(selected.includes(m.id) ? selected.filter(x => x !== m.id) : [...selected,m.id])} /><i /></label>)}</section>}
    {error && <div class="err" role="alert">{error}</div>}
    <div class="row gap">{step > 0 && <button class="btn" onClick={() => setStep(step - 1)}>Back</button>}{step < 3 ? <button class="btn primary grow" onClick={() => setStep(step + 1)} disabled={step === 1 && (!startDate || !examDate || examDate <= startDate || weekdayHours < 0 || weekendHours < 0)}>Continue</button> : <button class="btn primary grow" disabled={busy || !selected.includes('planner')} onClick={submit}>{busy ? 'Creating plan…' : 'Create my plan'}</button>}</div>
  </main>
}
