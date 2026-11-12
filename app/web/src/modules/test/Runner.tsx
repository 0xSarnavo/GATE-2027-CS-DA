import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useActiveStudy } from '../../active-time'
import { getTest, getTopics, submitTest } from '../../api'
import { Header, Loading, useLoad, Icon, Sheet, toast, Bar } from '../../ui'
import { cx, mmss } from '../../util'
import { go, back, exit, useLayer } from '../../router'
import { Md } from '../../md'
import { Calculator } from './Calculator'
import type { Q } from '../../types'

interface A { sel: string[]; nat: string; marked: boolean; visited: boolean; t: number }
const blank = (): A => ({ sel: [], nat: '', marked: false, visited: false, t: 0 })
const KEY = (id: string) => 'gate.test.' + id
const given = (q: Q, a?: A) => (!a ? '' : q.type === 'NAT' ? a.nat.trim() : [...a.sel].sort().join(','))
const KINDS: Record<string, string> = { quick: 'Quick test', topic: 'Topic set', pyq: 'PYQ paper', mock: 'Full mock' }
const NEG = (q: Q) => (q.type === 'MCQ' ? (q.marks === 2 ? '-2/3' : '-1/3') : 'no negative')

export default function Runner({ id }: { id: string }) {
  const t = useLoad(() => getTest(id), [id])
  const topics = useLoad(getTopics, [])
  if (t.loading || !t.data) return <><Header title="Test" onBack={() => go('test', true)} menu={false} /><main class="page"><Loading error={t.error} retry={t.reload} /></main></>
  if (t.data.submitted_at) { go('test/result/' + id, true); return null }
  return <Exam id={id} t={t.data} topics={topics.data ?? []} />
}

function Exam({ id, t, topics }: { id: string; t: NonNullable<ReturnType<typeof getTest> extends Promise<infer R> ? R : never>; topics: { id: string; parent_id: string | null }[] }) {
  const qs = t.questions
  const gate = t.kind === 'mock' || t.kind === 'pyq'
  const startMs = useMemo(() => Date.now() - 0, [id])
  const saved = useMemo(() => { try { return JSON.parse(localStorage.getItem(KEY(id)) || 'null') } catch { return null } }, [id])
  const [ans, setAns] = useState<Record<string, A>>(saved?.a ?? {})
  const [cur, setCur] = useState<number>(Math.min(saved?.cur ?? 0, qs.length - 1))
  const [sec, setSec] = useState<'all' | 'ga' | 'subj'>('all')
  const [pal, setPal] = useState(false); const [calc, setCalc] = useState(false); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)
  const [leaveAsk, setLeaveAsk] = useState(false)
  // system back / swipe asks before leaving; it is a history layer so the first back lands here, not on the previous screen
  const [leaving, setLeaving] = useState(false)
  useLayer(!leaveAsk && !leaving, () => { if (!sent.current) setLeaveAsk(true) })
  useLayer(calc, () => setCalc(false))
  const enter = useRef(Date.now()); const sent = useRef(false)
  const parent = useMemo(() => new Map(topics.map((x) => [x.id, x.parent_id])), [topics])
  const rootOf = (tid: string) => { let c = tid; for (let i = 0; i < 6 && parent.get(c); i++) c = parent.get(c)!; return c }
  const isGA = (q: Q) => rootOf(q.topic_id) === 'ga'
  const started = useMemo(() => { const s = new Date((t as any).started_at ?? '').getTime(); return isNaN(s) ? startMs : s }, [id])
  const remaining = Math.max(0, t.allowed_s - Math.floor((Date.now() - started) / 1000))
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(i) }, [])
  const q = qs[cur]
  useActiveStudy(q.topic_id)
  const a = ans[q.id] ?? blank()
  const persist = (next: Record<string, A>, c = cur) => { try { localStorage.setItem(KEY(id), JSON.stringify({ a: next, cur: c })) } catch { /* private mode */ } }
  const upd = (patch: Partial<A>, qid = q.id) => setAns((m) => { const n = { ...m, [qid]: { ...(m[qid] ?? blank()), ...patch } }; persist(n); return n })
  // time spent per question: add the dwell time to the question we leave
  const leave = () => { const dt = Math.max(0, Math.round((Date.now() - enter.current) / 1000)); enter.current = Date.now(); const cur0 = qs[cur]; const next = { ...ans, [cur0.id]: { ...(ans[cur0.id] ?? blank()), t: (ans[cur0.id]?.t ?? 0) + dt, visited: true } }; setAns(next); persist(next); return next }
  const goTo = (i: number) => { if (i < 0 || i >= qs.length) return; const next = leave(); setCur(i); persist(next, i); window.scrollTo(0, 0) }
  useEffect(() => { if (!ans[q.id]?.visited) upd({ visited: true }) }, [cur])
  const list = qs.map((x, i) => i).filter((i) => sec === 'all' || (sec === 'ga') === isGA(qs[i]))
  const nextIdx = () => { const p = list.indexOf(cur); return p >= 0 && p + 1 < list.length ? list[p + 1] : Math.min(cur + 1, qs.length - 1) }
  const status = (x: Q) => { const s = ans[x.id]; const has = !!given(x, s); return !s?.visited ? 'nv' : s.marked ? (has ? 'am' : 'm') : has ? 'a' : 'na' }
  const STAT_L: Record<string, string> = { nv: 'not visited', na: 'not answered', a: 'answered', m: 'marked for review', am: 'answered and marked for review' }
  const counts = { a: 0, na: 0, m: 0, am: 0, nv: 0 } as Record<string, number>; qs.forEach((x) => { counts[status(x)]++ })

  const doSubmit = async () => {
    if (sent.current) return; sent.current = true; setBusy(true)
    const final = leave()
    const payload = qs.map((x) => ({ question_id: x.id, given_answer: given(x, final[x.id]) || null, time_s: final[x.id]?.t ?? 0, marked: !!final[x.id]?.marked }))
    try {
      await submitTest(id, payload, Math.min(t.allowed_s, Math.floor((Date.now() - started) / 1000)))
      try { localStorage.removeItem(KEY(id)) } catch { /* ignore */ }
      go('test/result/' + id, true)
    } catch (e: any) { sent.current = false; setBusy(false); toast(e?.message || 'Could not submit. Check your connection, your answers are saved on this device.') }
  }
  useEffect(() => { if (remaining <= 0 && !sent.current) { toast('Time is up. Submitting.'); doSubmit() } }, [remaining <= 0])

  const pick = (k: string) => upd({ sel: q.type === 'MCQ' ? [k] : a.sel.includes(k) ? a.sel.filter((x) => x !== k) : [...a.sel, k] })
  const keys = q.options.length ? q.options.map((o) => o.key) : ['A', 'B', 'C', 'D']
  const hasImg = q.images.length > 0
  const low = remaining < 300

  const Palette = (
    <>
      <ul class="legend-p" aria-label="Legend">
        {(['nv', 'na', 'a', 'm', 'am'] as const).map((s) => <li><span class={'pq ' + s} aria-hidden="true">{counts[s]}</span>{STAT_L[s]}</li>)}
      </ul>
      <div class="pgrid" role="group" aria-label="Question palette">
        {list.map((i) => <button class={cx('pq', status(qs[i]), i === cur && 'cur')} aria-label={`Question ${i + 1}, ${STAT_L[status(qs[i])]}${i === cur ? ', current' : ''}`} onClick={() => { goTo(i); setPal(false) }}>{i + 1}</button>)}
      </div>
    </>
  )

  return (
    <div class="exam">
      <div class="qbar exam-bar">
        <button class="icon-btn" aria-label="Leave test (your answers are kept on this device)" onClick={() => back()}><Icon.close /></button>
        <h1 class="sr">{KINDS[t.kind]}</h1>
        <div class="grow"><small class="exam-k">{KINDS[t.kind]}</small><Bar pct={(counts.a + counts.am) / qs.length} label="Answered" /></div>
        <span class={cx('timer', low && 'low')} role="timer" aria-label={`Time left ${mmss(remaining)}`}>{mmss(remaining)}</span>
        <button class="icon-btn" aria-label="Calculator" aria-pressed={calc} onClick={() => setCalc(!calc)}><Icon.calc /></button>
        <button class="icon-btn" aria-label="Question palette" onClick={() => setPal(true)}><Icon.grid /></button>
      </div>
      {gate && (
        <div class="seg exam-sec" role="group" aria-label="Section">
          {([['all', 'All'], ['ga', 'General Aptitude'], ['subj', 'Subject']] as const).map(([v, l]) => <button class={cx(sec === v && 'on')} aria-pressed={sec === v} onClick={() => { setSec(v); const first = qs.findIndex((x) => v === 'all' || (v === 'ga') === isGA(x)); if (first >= 0 && !(v === 'all' || (v === 'ga') === isGA(q))) goTo(first) }}>{l}</button>)}
        </div>
      )}
      <main class="page q exam-q">
        <div class="qmeta">
          <b>Question {cur + 1} of {qs.length}</b>
          <span class="tag">{q.type}</span><span class="tag">{q.marks} mark{q.marks > 1 ? 's' : ''}</span><span class="tag">{NEG(q)}</span>
          {a.marked && <span class="tag must">marked</span>}
        </div>
        {q.images.map((src) => <img class="qimg zoomwrap" src={src} alt={`Question ${q.q_no ?? cur + 1}`} />)}
        {!hasImg && <Md text={q.stem} class="stem" />}
        {q.type === 'NAT' ? (
          <div class="nat">
            <label for="nat">Your answer (a number)</label>
            <input id="nat" type="text" inputMode={gate ? 'none' : 'decimal'} autocomplete="off" value={a.nat} placeholder="Enter a number"
              onInput={(e) => upd({ nat: (e.target as HTMLInputElement).value.replace(/[^0-9.\-eE]/g, '') })} />
            {gate && <div class="keypad" role="group" aria-label="Numeric keypad">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', '-'].map((d) => <button class="ck" onClick={() => upd({ nat: a.nat + d })}>{d}</button>)}
              <button class="ck fn" aria-label="Backspace" onClick={() => upd({ nat: a.nat.slice(0, -1) })}>{'⌫'}</button>
              <button class="ck fn wide" onClick={() => upd({ nat: '' })}>Clear</button>
            </div>}
          </div>
        ) : (
          <div class={cx('opts', hasImg && 'keys')} role={q.type === 'MCQ' ? 'radiogroup' : 'group'} aria-label="Options">
            {keys.map((k) => {
              const o = q.options.find((x) => x.key === k); const on = a.sel.includes(k)
              return <button class={cx('opt', on && 'on')} role={q.type === 'MCQ' ? 'radio' : 'checkbox'} aria-checked={on} onClick={() => pick(k)}><span class="k">{k}</span>{!hasImg && o && <Md text={o.text} />}</button>
            })}
            {q.type === 'MSQ' && <small class="muted">Select all that apply. No negative marking.</small>}
          </div>
        )}
      </main>
      <div class="actionbar exam-actions">
        <div class="exam-r1">
          <button class="btn sm" onClick={() => { upd({ marked: true }); goTo(nextIdx()) }}>Mark for review &amp; next</button>
          <button class="btn sm" onClick={() => upd({ sel: [], nat: '' })}>Clear response</button>
        </div>
        <div class="exam-r2">
          <button class="btn" disabled={cur === 0} onClick={() => goTo(cur - 1)}>Previous</button>
          {cur === qs.length - 1
            ? <button class="btn primary grow" onClick={() => setConfirm(true)}>Submit</button>
            : <button class="btn primary grow" onClick={() => { upd({ marked: false }); goTo(nextIdx()) }}>Save &amp; next</button>}
        </div>
      </div>
      {calc && <Calculator onClose={() => setCalc(false)} />}
      {leaveAsk && (
        <Sheet title="Leave the test?" onClose={() => setLeaveAsk(false)}>
          <p>Your answers are saved on this device. You can come back and carry on.</p>
          <div class="actions">
            <button class="btn primary block" onClick={() => setLeaveAsk(false)}>Keep going</button>
            <button class="btn block" onClick={() => { setLeaving(true); exit(() => go('test')) }}>Leave test</button>
          </div>
        </Sheet>
      )}
      {pal && <Sheet title="Question palette" onClose={() => setPal(false)}>{Palette}<button class="btn primary block" onClick={() => { setPal(false); setConfirm(true) }}>Submit test</button></Sheet>}
      {confirm && (
        <Sheet title="Submit this test?" onClose={() => setConfirm(false)}>
          <ul class="legend-p big">{(['a', 'na', 'm', 'am', 'nv'] as const).map((s) => <li><span class={'pq ' + s} aria-hidden="true">{counts[s]}</span>{STAT_L[s]}</li>)}</ul>
          <p class="muted">Time left {mmss(remaining)}. You cannot change answers after submitting.</p>
          <div class="actions"><button class="btn primary block" disabled={busy} onClick={doSubmit}>{busy ? 'Submitting...' : 'Submit'}</button><button class="btn block" onClick={() => setConfirm(false)}>Keep working</button></div>
        </Sheet>
      )}
    </div>
  )
}
