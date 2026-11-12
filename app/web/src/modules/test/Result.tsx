import { useState } from 'preact/hooks'
import { getTest, getTopics, getStrategy, patchAttempt, addTask, isQueued } from '../../api'
import { Header, Loading, useLoad, Bar, Icon, Empty, Art, Confetti, toast } from '../../ui'
import { cx, mmss, addDays, today } from '../../util'
import { go, back } from '../../router'
import { startSession } from '../../queue'
import { begin } from './Test'
import type { ErrorType } from '../../types'

const ERRORS: [ErrorType, string][] = [['concept', 'Concept'], ['calculation', 'Calculation'], ['reading', 'Misread'], ['time', 'Time'], ['guess', 'Guess']]
const KIND: Record<string, string> = { quick: 'Quick test', topic: 'Topic set', pyq: 'PYQ paper', mock: 'Full mock' }
const r1 = (n: number) => Math.round(n * 100) / 100

export default function Result({ id }: { id: string }) {
  const t = useLoad(() => getTest(id), [id])
  const topics = useLoad(getTopics, [])
  const strategy = useLoad(() => getStrategy(id).catch(() => null), [id])
  const [et, setEt] = useState<Record<string, ErrorType>>({})
  const [added, setAdded] = useState(false)
  if (t.loading || !t.data) return <><Header title="Result" onBack={() => go('test')} menu={false} /><main class="page"><Loading error={t.error} retry={t.reload} /></main></>
  const res = t.data.result
  if (!res) { go('test/run/' + id, true); return null }
  const qOf = new Map(t.data.questions.map((q) => [q.id, q]))
  const missed = res.per_question.filter((p) => p.correct !== true)
  const wrong = res.per_question.filter((p) => p.correct === false)
  const pct = res.max_score ? res.score / res.max_score : 0
  const good = pct >= 0.5
  const tname = (tid: string) => topics.data?.find((x) => x.id === tid)?.name ?? tid
  const practiseMissed = () => {
    const ids = missed.map((p) => p.question_id).slice(0, 12)
    if (!ids.length) return
    startSession(ids, 'Practise missed questions', 'test/result/' + id); go('q/' + ids[0])
  }
  const addToPlan = async () => {
    try {
      let n = 0
      for (const w of res.weak.slice(0, 3)) {
        const r = await addTask({ date: addDays(today(), 1 + n), title: `Revise ${w.name} (weak in ${KIND[res.kind].toLowerCase()})`, type: 'revision', topic_id: w.id, est_minutes: 30, priority: 2 } as any)
        if (isQueued(r)) toast('Saved offline, will sync'); n++
      }
      setAdded(true); toast(`${n} revision task${n === 1 ? '' : 's'} added to your plan`)
    } catch (e: any) { toast(e?.message || 'Could not add to the plan. Is the day inside your plan?') }
  }
  const retake = async () => { try { await begin('topic', { retake_of: id }) } catch (e: any) { toast(e?.message || 'Nothing to retake') } }
  return (
    <>
      <Header title={KIND[res.kind]} sub="Result" onBack={() => go('test')} menu={false} />
      <main class="page summary result">
        <Confetti fire={good} />
        <Art kind={good ? 'trophy' : 'target'} />
        <section class="score-hero" aria-label="Score">
          <small>Your score</small>
          <b class="big-score">{r1(res.score)}<span> / {res.max_score}</span></b>
          <small>{Math.round(pct * 100)}% of the marks</small>
        </section>
        <div class="sum-stats">
          <div class="sum-stat s-green"><small>Accuracy</small><b>{Math.round(res.accuracy * 100)}%</b></div>
          <div class="sum-stat s-blue"><small>Attempted</small><b>{res.attempted}/{res.attempted + res.unattempted}</b></div>
          <div class="sum-stat s-gold"><small>Correct / wrong</small><b>{res.correct} / {res.wrong}</b></div>
          <div class="sum-stat s-red"><small>Time</small><b>{mmss(res.duration_s)}</b></div>
        </div>

        {res.by_subject.length > 0 && (
          <section class="card"><h2>By subject</h2>
            <ul class="hbars">{res.by_subject.map((s) => <li><span class="l">{s.name}</span><span class="t"><i class={s.accuracy == null ? '' : s.accuracy >= 0.7 ? 'good' : s.accuracy >= 0.4 ? 'mid' : 'bad'} style={{ width: (s.accuracy ?? 0) * 100 + '%' }} /></span><span class="v">{r1(s.score)}/{s.max}</span></li>)}</ul>
          </section>
        )}

        {strategy.data && (res.kind==='mock'||res.kind==='pyq') && <section class="card"><h2>Mock strategy</h2>
          <p><b>{strategy.data.negative_marks_lost}</b> negative marks lost · <b>{strategy.data.guesses}</b> labelled guesses{strategy.data.guess_accuracy!==null?` (${Math.round(strategy.data.guess_accuracy*100)}% right)`:''}</p>
          <p>Try this order: <b>{strategy.data.suggested_attempt_order.join(' → ')}</b></p>
          <h3>Section time split</h3><ul class="list">{strategy.data.sections.map((x:any)=><li class="lrow">{x.name}: {Math.round(x.time_s/60)} min · {Math.round(x.marks*10)/10}/{x.max_marks} marks</li>)}</ul>
          <h3>Slowest questions</h3><ul class="list">{strategy.data.slowest.slice(0,5).map((x:any)=><li class="lrow">Q{x.pos}: {mmss(x.time_s)} for {x.marks} mark{x.marks===1?'':'s'}</li>)}</ul>
          <details><summary>Time per question vs marks</summary><ul class="list">{strategy.data.per_question.map((x:any)=><li class="lrow">Q{x.pos} · {x.section}: {mmss(x.time_s)} / {x.marks} mark{x.marks===1?'':'s'}</li>)}</ul></details>
          {strategy.data.skip_candidates.length>0 && <p>Consider skipping sooner: {strategy.data.skip_candidates.map((x:any)=>'Q'+x.pos).join(', ')} each took over 2× your median and was wrong.</p>}
        </section>}

        {res.weak.length > 0 && (
          <section class="card" aria-label="Weak chapters">
            <h2>Weak chapters</h2>
            <ul class="list">
              {res.weak.map((w) => <li><button class="lrow col" onClick={() => go('practice/' + w.id)}>
                <span class="row between"><b>{w.name}</b><small>{w.correct}/{w.total} right</small></span>
                <Bar pct={w.total ? w.correct / w.total : 0} label={w.name} />
              </button></li>)}
            </ul>
            <div class="actions weak-act">
              <button class="btn primary block" onClick={practiseMissed} disabled={!missed.length}>Practise these ({Math.min(12, missed.length)})</button>
              <button class="btn block" disabled={added} onClick={addToPlan}>{added ? 'Added to your plan' : 'Add to plan'}</button>
            </div>
          </section>
        )}
        {res.weak.length === 0 && <Empty art="trophy" title="No weak chapters">Every chapter in this test went well.</Empty>}

        {wrong.length > 0 && (
          <section class="card" aria-label="What went wrong">
            <h2>What went wrong? <small>added to Mistakes</small></h2>
            <ul class="wrong-list">
              {wrong.map((p) => { const q = qOf.get(p.question_id); return (
                <li>
                  <div class="row between"><b>Q{p.pos} <small>{tname(p.topic_id)}</small></b><small>yours {p.given_answer} · answer {p.correct_answer}</small></div>
                  <div class="chips">{ERRORS.map(([v, l]) => <button class={cx('chip', et[p.question_id] === v && 'on')} aria-pressed={et[p.question_id] === v} onClick={() => { if (!p.attempt_id) return; setEt({ ...et, [p.question_id]: v }); patchAttempt(p.attempt_id, { error_type: v }).catch(() => toast('Could not save')) }}>{l}</button>)}</div>
                  {q && <button class="btn sm link" onClick={() => go('q/' + q.id)}>See solution</button>}
                </li>
              ) })}
            </ul>
          </section>
        )}

        <section class="card"><h2>By chapter</h2>
          <ul class="list">{res.by_chapter.map((c) => <li class="lrow"><span>{c.name}</span><small>{c.correct}/{c.total}</small><span class={cx('mark', c.correct === c.total ? 'ok' : c.correct === 0 && c.attempted > 0 ? 'bad' : 'none')} aria-hidden="true">{c.correct === c.total ? '✓' : c.correct === 0 && c.attempted > 0 ? '✗' : ''}</span></li>)}</ul>
        </section>

        <div class="actions">
          <button class="btn primary block" onClick={() => back(() => go('test'))}>Done</button>
          {missed.length > 0 && res.kind !== 'mock' && res.kind !== 'pyq' && <button class="btn block" onClick={retake}><Icon.swap size={16} /> Retake the wrong ones only</button>}
        </div>
      </main>
    </>
  )
}
