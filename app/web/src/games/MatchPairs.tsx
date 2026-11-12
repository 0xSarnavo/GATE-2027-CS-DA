import { usePrefs } from '../store'
import { useEffect, useRef, useState } from 'preact/hooks'
import { get, getCards, reviewCard, postScore } from '../api'
import { Header, Loading, useLoad, Empty, toast } from '../ui'
import { go, back } from '../router'
import { Md } from '../md'
import { cx, mmss, shuffle, arr } from '../util'

interface Tile { key: string; card_id: string; text: string; side: 'l' | 'r' }
interface Pair { card_id: string; left: string; right: string }

async function loadPairs(topic: string | undefined, n: number): Promise<Pair[]> {
  try {
    const r = await get(`/games/pairs?n=${n}${topic ? '&topic_id=' + topic : ''}`)
    const p = arr<Pair>(r, 'round').length ? arr<Pair>(r, 'round') : arr<Pair>(r, 'items')
    if (p.length >= 3) return p.slice(0, n)
  } catch { /* fall through to local build */ }
  const cards = await getCards(topic)
  const ok = cards.filter((c) => c.kind === 'pair' || (c.front.length <= 48 && c.back.length <= 48))
  return shuffle(ok).slice(0, n).map((c) => ({ card_id: c.id, left: c.front, right: c.back }))
}

export default function MatchPairs({ topic }: { topic?: string }) {
  const [round, setRound] = useState(0)
  const { data, error, loading, reload } = useLoad(() => loadPairs(topic, 6), [topic, round])
  const exit = () => back(() => go('cards'))
  if (loading || !data) return <><Header title="Match pairs" onBack={exit} menu={false} /><main class="page"><Loading error={error} retry={reload} /></main></>
  if (data.length < 3) return <><Header title="Match pairs" onBack={exit} menu={false} /><main class="page"><Empty>Need at least 3 short cards in this topic to play.</Empty></main></>
  return <Game key={round} pairs={data} topic={topic} again={() => setRound(round + 1)} exit={exit} />
}

function Game({ pairs, topic, again, exit }: { pairs: Pair[]; topic?: string; again: () => void; exit: () => void }) {
  const [tiles] = useState<Tile[]>(() => shuffle(pairs.flatMap((p) => [
    { key: p.card_id + 'l', card_id: p.card_id, text: p.left, side: 'l' as const },
    { key: p.card_id + 'r', card_id: p.card_id, text: p.right, side: 'r' as const }])))
  const [sel, setSel] = useState<Tile | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [bad, setBad] = useState<string[]>([])
  const [wrong, setWrong] = useState(0)
  const prefs = usePrefs()
  const [secs, setSecs] = useState(0)
  const start = useRef(Date.now()); const over = done.size === pairs.length
  const final = useRef(0)
  useEffect(() => { if (over) return; const i = setInterval(() => setSecs(Math.floor((Date.now() - start.current) / 1000)), 500); return () => clearInterval(i) }, [over])

  const score = Math.max(0, pairs.length * 100 - secs * 2 - wrong * 25)
  const tap = (t: Tile) => {
    if (done.has(t.card_id) || over) return
    if (!sel) return setSel(t)
    if (sel.key === t.key) return setSel(null)
    if (sel.card_id === t.card_id && sel.side !== t.side) {
      if (prefs.haptics) navigator.vibrate?.(12)
      const nd = new Set(done); nd.add(t.card_id); setDone(nd); setSel(null)
      reviewCard(t.card_id, 4, Date.now() - start.current, 'match').catch(() => {})
      if (nd.size === pairs.length) {
        const d = Math.floor((Date.now() - start.current) / 1000); final.current = d; setSecs(d)
        const sc = Math.max(0, pairs.length * 100 - d * 2 - wrong * 25)
        postScore({ game: 'pairs', topic_id: topic, score: sc, duration_s: d, detail: JSON.stringify({ pairs: pairs.length, wrong }) }).catch(() => toast('Score not saved'))
      }
    } else {
      if (prefs.haptics) navigator.vibrate?.([12, 40, 12])
      reviewCard(sel.card_id, 1, undefined, 'match').catch(() => {})
      setWrong(wrong + 1); setBad([sel.key, t.key]); setSel(null); setTimeout(() => setBad([]), 450)
    }
  }
  return (
    <>
      <Header title="Match pairs" onBack={exit} menu={false} right={<span class="timer">{mmss(secs)}</span>} />
      <main class="page">
        <p class="muted center">Tap a name, then its matching formula or answer. Mistakes: {wrong}</p>
        <div class="tiles">
          {tiles.map((t) => (
            <button class={cx('tile', done.has(t.card_id) && 'done', sel?.key === t.key && 'sel', bad.includes(t.key) && 'bad', t.side === 'l' && 'name')}
              disabled={done.has(t.card_id)} aria-pressed={sel?.key === t.key} onClick={() => tap(t)}><Md text={t.text} /></button>
          ))}
        </div>
        {over && (
          <div class="card result">
            <b class="big">{score}</b><span>points in {mmss(final.current || secs)}, {wrong} mistake{wrong === 1 ? '' : 's'}</span>
            <div class="two"><button class="btn primary" onClick={again}>Play again</button><button class="btn" onClick={exit}>Done</button></div>
          </div>
        )}
      </main>
    </>
  )
}
