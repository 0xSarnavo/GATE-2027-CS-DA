import { usePrefs } from '../../store'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useActiveStudy } from '../../active-time'
import { getQuestion, postAttempt, patchAttempt, flagQuestion, getBookmarks, setBookmark, getQuestionVideo } from '../../api'
import { Header, Loading, useLoad, toast, Icon, Bar, Art, Confetti, CopySearch } from '../../ui'
import { cx, mmss } from '../../util'
import { go, back, useLayer } from '../../router'
import { gradeLocal, prettyAnswer, sortedKeys, answerKeys } from '../../grade'
import { Md, Layered } from '../../md'
import { nextAfter, queuePos, getSession, inSession, recordResult, startSession, xpFor } from '../../queue'
import { qLabel, qTitle, typeName } from './Practice'
import { LEVELS } from './path'
import { DoubtButton } from '../insights/DoubtButton'
import type { ErrorType, Q } from '../../types'
import { openVideo } from '../learn/VideoPlayer'

const ERRORS: [ErrorType, string][] = [['concept', 'Concept'], ['calculation', 'Calculation'], ['reading', 'Misread'], ['time', 'Time'], ['guess', 'Guess']]
const PRAISE = ['Nicely done!', 'Correct!', 'Great work!', 'You got it!', 'Spot on!']

export default function QuestionRoute({ id, query }: { id: string; query: URLSearchParams }) {
  return id === 'done' ? <SessionSummary /> : <QuestionScreen id={id} query={query} />
}

function QuestionScreen({ id, query }: { id: string; query: URLSearchParams }) {
  const { data: q, error, loading, reload } = useLoad(() => getQuestion(id), [id])
  if (loading || !q) return <><Header title="Question" onBack menu={false} /><main class="page"><Loading error={error} retry={reload} /></main></>
  const nxt = nextAfter(id)
  const sess = inSession(id) ? getSession() : null
  // last question of a session: continue to the summary (if anything was answered), otherwise just leave
  const onNext = nxt ? () => go('q/' + nxt, true) : sess ? () => (Object.keys(getSession()?.results ?? {}).length ? go('q/done', true) : back(() => go(sess.back))) : undefined
  return <QuestionView key={q.id} q={q} onNext={onNext} nextLabel={nxt ? 'Continue' : sess ? 'Finish' : 'Continue'} onExit={sess ? () => back(() => go(sess.back)) : () => back(() => go(query.get('from') || 'practice/' + q.topic_id))}
    onResult={(ok, info) => { if (sess) recordResult(q.id, { correct: ok, timeS: info.timeS, hint: info.hint, label: qLabel(q) }) }} />
}

export function QuestionView({ q, onNext, onExit, onResult, nextLabel = 'Continue' }: {
  q: Q; onNext?: () => void; onExit: () => void; onResult?: (correct: boolean, info: { timeS: number; hint: boolean }) => void; nextLabel?: string
}) {
  useActiveStudy(q.topic_id)
  const [sel, setSel] = useState<string[]>([])
  const [nat, setNat] = useState('')
  const [res, setRes] = useState<{ correct: boolean; given: string; self: boolean } | null>(null)
  const [selfGrade, setSelfGrade] = useState(false) // no answer key: solution shown, waiting for "I got it right / wrong"
  const [hintsShown, setHints] = useState(0)
  const [et, setEt] = useState<ErrorType | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  useLayer(!!zoom, () => setZoom(null))
  const [flagged, setFlagged] = useState(q.needs_review)
  const start = useRef(Date.now()); const frozen = useRef(0)
  const attemptId = useRef<Promise<string> | null>(null)
  const [, tick] = useState(0)
  const revealed = !!res || selfGrade
  const revealEl = useRef<HTMLDivElement>(null); const hintsEl = useRef<HTMLDivElement>(null); const contBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (res) setTimeout(() => contBtn.current?.focus({ preventScroll: true }), 120) }, [!!res])
  useEffect(() => { if (revealed) return; const i = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(i) }, [revealed])

  const elapsed = revealed ? frozen.current : Math.floor((Date.now() - start.current) / 1000)
  const given = q.type === 'NAT' ? nat.trim() : sortedKeys(sel.join(','))
  const canSubmit = !q.has_key || (q.type === 'NAT' ? given !== '' && Number.isFinite(Number(given.replace(/,/g, ''))) : sel.length > 0)

  const prefs = usePrefs()
  const record = (correct: boolean, self: boolean) => {
    if (prefs.haptics) navigator.vibrate?.(correct ? 12 : [12, 40, 12])
    setRes({ correct, given, self }); setSelfGrade(false)
    attemptId.current = postAttempt({ question_id: q.id, given_answer: given, time_s: frozen.current, correct, used_hint: hintsShown > 0, self_graded: self })
    attemptId.current.catch(() => toast('Could not record attempt'))
    onResult?.(correct, { timeS: frozen.current, hint: hintsShown > 0 })
  }
  const submit = () => {
    frozen.current = Math.floor((Date.now() - start.current) / 1000)
    if (!q.has_key) { setSelfGrade(true); return }
    record(gradeLocal(q, given), false)
  }
  const pickEt = (e: ErrorType) => {
    setEt(e)
    attemptId.current?.then((id) => patchAttempt(id, { error_type: e })).catch(() => toast('Could not save error type'))
  }
  const pick = (k: string) => setSel((s) => (q.type === 'MCQ' ? [k] : s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))
  const keys = q.options.length ? q.options.map((o) => o.key) : ['A', 'B', 'C', 'D']
  const localImgs = q.images.filter((x) => !/^https?:/.test(x)), remoteImgs = q.images.filter((x) => /^https?:/.test(x))
  const hasImg = localImgs.length > 0
  const pos = queuePos(q.id)
  const curated = useLoad(() => getQuestionVideo(q.id).catch(() => ({video:null})), [q.id])
  const selectedVideo = curated.data?.video
  const video = selectedVideo || (q.video_url ? { url: q.video_url, start_s: q.video_start_s || 0, title: 'Question video' } : null)
  const isCorrectKey = (k: string) => revealed && q.has_key && answerKeys(q).has(k)
  const bm = useLoad(getBookmarks, [])
  const starred = !!bm.data?.has(q.id)
  const toggleStar = () => { bm.set((s) => { const n = new Set(s ?? []); starred ? n.delete(q.id) : n.add(q.id); return n }); setBookmark(q.id, !starred).catch(() => { toast('Could not save bookmark'); bm.reload() }) }
  const hintsLeft = q.hints.length - hintsShown
  const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth') as ScrollBehavior
  const why = oneLineWhy(q)
  const praise = PRAISE[(q.id.length + q.id.charCodeAt(q.id.length - 1)) % PRAISE.length]

  return (
    <>
      <div class="qbar">
        <button class="icon-btn" aria-label="Close question" onClick={onExit}><Icon.close /></button>
        <h1 class="sr">{qTitle(q)}</h1>
        {pos ? <Bar pct={(pos[0] - 1 + (revealed ? 1 : 0)) / pos[1]} label={`Question ${pos[0]} of ${pos[1]}`} /> : <span class="grow" />}
        <div class="qmeta-r">
          <button class={cx('icon-btn star', starred && 'on')} aria-pressed={starred} aria-label={starred ? 'Remove bookmark' : 'Bookmark this question'} onClick={toggleStar}>{starred ? <Icon.starFill /> : <Icon.star />}</button>
          <span class={cx('timer', revealed && 'stop')} role="timer" aria-label={`Elapsed time ${mmss(elapsed)}`}>{mmss(elapsed)}</span>
        </div>
      </div>
      <main class={cx('page q', revealed && 'revealed')}>
        <div class="qmeta">
          <span class="tag">{typeName(q.type)} {'\u00b7'} {q.marks} mark{q.marks > 1 ? 's' : ''}</span>
          {q.level && <span class="tag lvl">Level {q.level}: {LEVELS[q.level - 1]}</span>}
          {q.outside_syllabus && <span class="tag outside" title={q.syllabus_note}>outside the 2027 syllabus</span>}
          {(flagged || !q.has_key) && <span class="tag warn"><Icon.flag size={12} /> {q.has_key ? 'needs review' : 'no answer key yet'}</span>}
          {q.answer_check === 'disagrees' && <span class="tag bad">answer key disputed</span>}
        </div>

        {localImgs.map((src) => (
          <button class="zoomwrap" onClick={() => setZoom(src)} aria-label="Open image full screen">
            <img class="qimg" src={src} alt={`Question ${q.q_no ?? ''}`} />
            <small>Tap to zoom</small>
          </button>
        ))}
        {!hasImg && <Md text={q.stem} class="stem" />}
        {q.stem && !q.garbled && <CopySearch text={[q.stem, ...q.options.map((o) => `${o.key}. ${o.text}`)].join('\n')} query={q.stem} />}
        {remoteImgs.map((src) => <img class="qimg remote" src={src} loading="lazy" referrerpolicy="no-referrer" alt="Figure" onError={(e) => { (e.target as HTMLElement).style.display = 'none' }} />)}
        {hasImg && q.stem && !q.garbled && (
          <details class="textver"><summary>Text version</summary><Md text={q.stem} class="stem" />
            {q.options.map((o) => <div><b>{o.key}.</b> <Md text={o.text} /></div>)}</details>
        )}

        {q.type === 'NAT' ? (
          <div class="nat">
            <label for="nat">Your answer (a number)</label>
            <input id="nat" type="text" inputMode="decimal" autocomplete="off" disabled={revealed} value={nat}
              onInput={(e) => setNat((e.target as HTMLInputElement).value.replace(/[^0-9.\-eE]/g, ''))} placeholder="e.g. 12.5"
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && !revealed && submit()} />
          </div>
        ) : (
          <div class={cx('opts', hasImg && 'keys')} role={q.type === 'MCQ' ? 'radiogroup' : 'group'} aria-label="Options">
            {keys.map((k) => {
              const o = q.options.find((x) => x.key === k)
              const on = sel.includes(k)
              return (
                <button class={cx('opt', on && 'on', isCorrectKey(k) && 'right', res && q.has_key && on && !isCorrectKey(k) && 'wrong')}
                  disabled={revealed} role={q.type === 'MCQ' ? 'radio' : 'checkbox'} aria-checked={on} onClick={() => pick(k)}>
                  <span class="k">{isCorrectKey(k) ? '✓' : res && q.has_key && on ? '✗' : k}</span>{!hasImg && o && <Md text={o.text} />}
                  {isCorrectKey(k) && <span class="sr">{k}: correct answer</span>}{res && q.has_key && on && !isCorrectKey(k) && <span class="sr">{k}: your answer, incorrect</span>}
                </button>
              )
            })}
            {q.type === 'MSQ' && !revealed && <small class="muted">Select all that apply.</small>}
          </div>
        )}

        {q.hints.length > 0 && (
          <div class="hints" ref={hintsEl}>
            {q.hints.slice(0, hintsShown).map((h, i) => (
              <div class="hint-card"><b>Hint {i + 1} of {q.hints.length}</b><Md text={h} /></div>
            ))}
            {!revealed && (
              <div class="q-more">
                {hintsShown < q.hints.length && <button class="btn link hint-link" onClick={() => setHints(hintsShown + 1)}>{hintsShown === 0 ? 'Need a hint?' : 'Another hint?'}</button>}
                <DoubtButton refType="question" refId={q.id} />
              </div>
            )}
          </div>
        )}

        {revealed && (
          <div class="reveal" ref={revealEl}>
            {!res && (
              <div class="verdict neutral" role="status">
                <b>No answer key yet</b>
                <span>Work it out from the solution below{q.solution || q.quick_method ? '' : ' or the discussion link'}, then mark yourself.</span>
              </div>
            )}
            {q.answer_check === 'disagrees' && (
              <div class="note warn" role="alert"><b>Our re-solve disagrees with the key.</b> <Md text={q.answer_check_note}/></div>
            )}
            {q.answer_check === 'unsure' && <div class="note">We could not fully confirm this key. <Md text={q.answer_check_note}/></div>}
            {res && !res.correct && (
              <details class="et">
                <summary>What went wrong? {et ? <small>({ERRORS.find(([v]) => v === et)?.[1]})</small> : null}</summary>
                <small>Picking one adds it to your Mistakes revision.</small>
                <div class="chips">{ERRORS.map(([v, l]) => <button class={cx('chip', et === v && 'on')} aria-pressed={et === v} onClick={() => pickEt(v)}>{l}</button>)}</div>
              </details>
            )}
            <Section title="Quick way to solve" focus={q.quick_method} full={q.quick_method_full} />
            <Section title="Solution" focus={q.solution} full={q.solution_full} />
            <Section title="Concept" focus={q.explanation} full={q.explanation_full} />
            <Section title="Trap" focus={q.trap_note} full={q.trap_note_full} tone="warn" />
            {q.answer_check === 'agrees' && q.source !== 'generated' && <small class="muted">Key independently re-checked.</small>}
            {q.source === 'generated' && !q.needs_review && <small class="muted">Original practice question, solved twice.</small>}
            <div class="row gap wrap">
              {video && <button class="btn grow" onClick={() => openVideo(video)}><Icon.play size={18} /> Watch</button>}
              {q.discussion_url && /^https?:\/\//i.test(q.discussion_url) && <a class="btn grow" href={q.discussion_url} target="_blank" rel="noopener noreferrer">Discussion</a>}
            </div>
 <div class="q-more"><DoubtButton refType="question" refId={q.id} />{!flagged && <button class="btn sm ghost" onClick={() => { setFlagged(true); flagQuestion(q.id).then(() => toast('Flagged for review')) }}><Icon.flag size={14} /> Flag answer as wrong</button>}</div>
          </div>
        )}
        {!revealed && q.hints.length === 0 && <div class="q-more"><DoubtButton refType="question" refId={q.id} /></div>}
      </main>

      {res ? (
        <div class={cx('fsheet', res.correct ? 'ok' : 'bad')} role="status" aria-live="polite">
          <div class="fs-h">
            <span class="fs-ic">{res.correct ? <Icon.check size={26} /> : <Icon.close size={26} />}</span>
            <h2>{res.correct ? praise : q.has_key ? 'Correct answer:' : 'Keep going'}</h2>
            {res.correct && <small class="xp-gain">+{xpFor({ correct: true, hint: hintsShown > 0 })} points</small>}
          </div>
          {q.has_key && (!res.correct || res.self === false) && (
            <div class="fs-a">{res.correct ? <>Answer: </> : null}<b>{prettyAnswer(q)}</b>{!res.correct && res.given ? <> &middot; yours: {res.given}</> : null}
              {res.correct && <small class="fs-src"> {q.answer_source === 'external' ? '(external source, unverified)' : q.answer_source === 'gateoverflow' ? '(GATE Overflow, community)' : ''}</small>}</div>
          )}
          {why && <div class="fs-why"><Md text={why} /></div>}
          <div class="fs-links">
            <button onClick={() => revealEl.current?.scrollIntoView({ block: 'start', behavior: smooth() })}>See full solution</button>
          </div>
          <button ref={contBtn} class={cx('btn', res.correct ? 'ok' : 'wrong')} onClick={() => { onNext ? onNext() : onExit() }}>{res.correct ? nextLabel : onNext ? 'Got it' : 'Finish'}</button>
        </div>
      ) : (
        <div class="actionbar">
          {selfGrade ? (
            <>
              <button class="btn grade again grow" onClick={() => record(false, true)}><b>I got it wrong</b></button>
              <button class="btn grade good grow" onClick={() => record(true, true)}><b>I got it right</b></button>
            </>
          ) : (
            <>
              <button class="btn" onClick={() => { onNext ? onNext() : onExit() }}>Skip</button>
              <button class="btn primary grow" disabled={!canSubmit} onClick={submit}>{q.has_key ? 'Check' : 'Show solution'}</button>
            </>
          )}
        </div>
      )}
      {zoom && (
        <div class="lightbox" onClick={() => setZoom(null)}>
          <button class="btn sm close" aria-label="Close">Close</button>
          <div class="lb-scroll" onClick={(e) => e.stopPropagation()}><img src={zoom} alt="Question, zoomed" /></div>
        </div>
      )}
    </>
  )
}

/** First sentence of the explanation (or solution, or quick method), as a one-line reason in the feedback sheet. */
function oneLineWhy(q: Q): string {
  const paras = [q.explanation, q.quick_method, q.solution].filter(Boolean).join('\n\n').split(/\n\s*\n/)
  for (const para of paras) {
    const sentences = para.replace(/^[-*]\s+/gm, '').match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? []
    for (const raw of sentences) {
      const one = raw.trim()
      if (one.endsWith('?') || one.length < 25 || one.length > 170 || (one.match(/\$/g)?.length ?? 0) % 2) continue
      return one
    }
  }
  return ''
}

function Section({ title, focus, full, tone }: { title: string; focus?: string; full?: string; tone?: string }) {
  if (!focus && !full) return null
  return <details class={cx('sec', tone)} open={title.startsWith('Quick')}><summary>{title}</summary><Layered focus={focus} full={full} /></details>
}

/** End of a session: accuracy, time, XP and mistakes added, with a short confetti burst when it went well. */
function SessionSummary() {
  const s = getSession()
  const rs = s ? s.ids.filter((i) => s.results[i]).map((i) => ({ id: i, ...s.results[i] })) : []
  if (!s || !rs.length) return <><Header title="Session" onBack={() => go('practice', true)} menu={false} /><main class="page"><div class="empty"><Art kind="empty" /><b>No session to show</b>Pick a level on the path to start one.<br /><button class="btn primary" onClick={() => go('practice', true)}>Back to Practice</button></div></main></>
  const right = rs.filter((r) => r.correct).length, wrong = rs.length - right
  const acc = Math.round((right / rs.length) * 100)
  const time = rs.reduce((n, r) => n + r.timeS, 0)
  const xp = rs.reduce((n, r) => n + xpFor(r), 0)
  const great = acc >= 60
  return (
    <>
      <Header title="Session complete" menu={false} />
      <main class="page summary">
        <Confetti fire={great} />
        <Art kind={great ? 'trophy' : 'target'} />
        <div><h1>{acc === 100 ? 'Perfect run!' : great ? 'Nicely done!' : 'Good effort. Keep at it.'}</h1><p class="muted"><Md text={s.label}/> {rs.length} question{rs.length === 1 ? '' : 's'}</p></div>
        <div class="sum-stats">
          <div class="sum-stat s-gold"><small>Points earned</small><b><Icon.bolt size={22} />{xp}</b></div>
          <div class="sum-stat s-green"><small>Accuracy</small><b>{acc}%</b></div>
          <div class="sum-stat s-blue"><small>Time</small><b>{mmss(time)}</b></div>
          <div class="sum-stat s-red"><small>Mistakes added</small><b>{wrong}</b></div>
        </div>
        <ul class="card list sum-list">
          {rs.map((r) => <li class="lrow"><span class={cx('mark', r.correct ? 'ok' : 'bad')} aria-hidden="true">{r.correct ? '✓' : '✗'}</span><span><Md text={r.label}/><span class="sr">{r.correct ? ', correct' : ', wrong'}</span></span><small>{mmss(r.timeS)}</small></li>)}
        </ul>
        <div class="actions">
          <button class="btn primary block" onClick={() => back(() => go(s.back))}>Continue</button>
          {wrong > 0 && <button class="btn block" onClick={() => { const ids = rs.filter((r) => !r.correct).map((r) => r.id); startSession(ids, 'Retry wrong answers', s.back); go('q/' + ids[0], true) }}>Retry the {wrong} I missed</button>}
        </div>
      </main>
    </>
  )
}
