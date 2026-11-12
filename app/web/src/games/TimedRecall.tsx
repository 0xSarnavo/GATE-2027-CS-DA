import { usePrefs } from '../store'
import { useEffect, useRef, useState } from 'preact/hooks'
import { getCards, reviewCard, postScore } from '../api'
import { Header, Loading, useLoad, Empty, toast } from '../ui'
import { go, back } from '../router'
import { Md } from '../md'
import { shuffle } from '../util'
import type { Card } from '../types'

const LIMIT = 60

export default function TimedRecall({ topic }: { topic?: string }) {
  const [round, setRound] = useState(0)
  const { data, error, loading, reload } = useLoad(() => getCards(topic).then((c) => shuffle(c)), [topic, round])
  const exit = () => back(() => go('cards'))
  if (loading || !data) return <><Header title="Timed recall" onBack={exit} menu={false} /><main class="page"><Loading error={error} retry={reload} /></main></>
  if (!data.length) return <><Header title="Timed recall" onBack={exit} menu={false} /><main class="page"><Empty>No cards to play with yet.</Empty></main></>
  return <Play key={round} cards={data} topic={topic} again={() => setRound(round + 1)} exit={exit} />
}

function Play({ cards, topic, again, exit }: { cards: Card[]; topic?: string; again: () => void; exit: () => void }) {
  const [started, setStarted] = useState(false)
  const [left, setLeft] = useState(LIMIT)
  const [i, setI] = useState(0); const [reveal, setReveal] = useState(false); const [typed, setTyped] = useState('')
  const [got, setGot] = useState(0); const [missed, setMissed] = useState(0); const [streak, setStreak] = useState(0); const [best, setBest] = useState(0)
  const t0 = useRef(Date.now()); const gameStart = useRef(0); const posted = useRef(false)
  const over = started && left <= 0
  useEffect(() => {
    if (!started || over) return
    const iv = setInterval(() => setLeft(Math.max(0, LIMIT - Math.floor((Date.now() - gameStart.current) / 1000))), 250)
    return () => clearInterval(iv)
  }, [started, over])
  useEffect(() => {
    if (over && !posted.current) { posted.current = true; postScore({ game: 'recall', topic_id: topic, score: got, duration_s: LIMIT, detail: JSON.stringify({ missed, best }) }).catch(() => toast('Score not saved')) }
  }, [over])

  const c = cards[i % cards.length]
  const prefs = usePrefs()
  const grade = (ok: boolean) => {
    if (prefs.haptics) navigator.vibrate?.(ok ? 12 : [12, 40, 12])
    const secs = (Date.now() - t0.current) / 1000
    reviewCard(c.id, ok ? (secs < 5 ? 5 : secs < 12 ? 4 : 3) : 1, Math.round(secs * 1000), 'recall').catch(() => {})
    if (ok) { setGot(got + 1); setStreak(streak + 1); setBest(Math.max(best, streak + 1)) } else { setMissed(missed + 1); setStreak(0) }
    setI(i + 1); setReveal(false); setTyped(''); t0.current = Date.now()
  }
  const hit = typed.trim() && c.back.trim().toLowerCase().includes(typed.trim().toLowerCase())

  return (
    <>
      <Header title="Timed recall" onBack={exit} menu={false} right={started ? <span class={'timer' + (left <= 10 ? ' low' : '')}>{left}s</span> : undefined} />
      <main class="page review">
        {!started ? (
          <div class="card result"><h2>60 seconds</h2><p class="muted">See the front, recall the back, reveal, then grade yourself. Quick right answers schedule longer.</p>
            <button class="btn primary block" onClick={() => { gameStart.current = Date.now(); t0.current = Date.now(); setStarted(true) }}>Start</button></div>
        ) : over ? (
          <div class="card result"><b class="big">{got}</b><span>recalled, {missed} missed, best streak {best}</span>
            <div class="two"><button class="btn primary" onClick={again}>Play again</button><button class="btn" onClick={exit}>Done</button></div></div>
        ) : (
          <>
            <div class="row between"><small>Correct {got}</small><small>Streak {streak}</small></div>
            <div class="flash static"><div class="face"><Md text={c.front} /></div>
              {reveal && <div class="face back"><Md text={c.back} />{typed.trim() && <small class="muted">You typed: {typed} {hit ? '(looks right)' : ''}</small>}</div>}</div>
            {!reveal && <input class="recall-in" placeholder="Type your answer (optional)" value={typed} autoComplete="off" onInput={(e) => setTyped((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && setReveal(true)} />}
          </>
        )}
      </main>
      {started && !over && (
        <div class="actionbar grades">
          {!reveal ? <button class="btn primary grow" onClick={() => setReveal(true)}>Reveal</button> : (
            <><button class="btn grade again grow" onClick={() => grade(false)}><b>Missed</b></button><button class="btn grade good grow" onClick={() => grade(true)}><b>Got it</b></button></>
          )}
        </div>
      )}
    </>
  )
}
