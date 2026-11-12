import { useEffect, useMemo, useState } from 'preact/hooks'
import { useActiveStudy } from '../../active-time'
import { getDueCards, getCards, getTopics, reviewCard, addCard, isQueued, getToday } from '../../api'
import { Header, Loading, useLoad, Empty, Field, toast, Seg, Icon, Bar, Sheet, Confetti } from '../../ui'
import { go, back as navBack } from '../../router'
import { useModules } from '../index'
import { Md } from '../../md'
import { sm2Next, ivLabel } from '../../grade'
import { cx } from '../../util'
import MatchPairs from '../../games/MatchPairs'
import TimedRecall from '../../games/TimedRecall'
import type { Card } from '../../types'

export default function Cards({ parts, query }: { parts: string[]; query: URLSearchParams }) {
  const [a, b] = parts
  if (a === 'review') return <Review />
  if (a === 'game' && b === 'pairs') return <MatchPairs topic={query.get('topic') || undefined} />
  if (a === 'game' && b === 'recall') return <TimedRecall topic={query.get('topic') || undefined} />
  if (a === 'add') return <><Home /><AddCard topic={query.get('topic') || undefined} /></>
  if (a === 'deck') return <Deck topic={b} />
  return <Home />
}

function Home() {
  const insightsOn = useModules().some((m) => m.id === 'insights' && m.enabled)
  const due = useLoad(() => getDueCards(100), [])
  const cards = useLoad(() => getCards(), [])
  const topics = useLoad(getTopics, [])
  const today = useLoad(() => getToday().catch(() => undefined), [])
  const counts = useMemo(() => { const m = new Map<string, number>(); (cards.data ?? []).forEach((c) => c.topic_id && m.set(c.topic_id, (m.get(c.topic_id) ?? 0) + 1)); return m }, [cards.data])
  const withCards = (topics.data ?? []).filter((t) => counts.has(t.id))
  const nDue = due.data?.length ?? 0
  const nMist = today.data?.due?.mistakes ?? 0
  return (
    <>
      <Header title="Review" sub="Revise flashcards and mistakes." />
      <main class="page">
        <div class="bigtiles two-up">
          <button class={cx('bigtile v', nDue > 0 && 'primary')} disabled={!nDue} onClick={() => go('cards/review')}>
            <span class="bt-n">{due.loading ? '...' : nDue}</span><span class="bt-t"><b>Flashcards due</b><small>{nDue ? 'Tap to start reviewing' : 'Nothing due right now'}</small></span>
          </button>
          <button class="bigtile v" onClick={() => go('mistakes')}>
            <span class="bt-n">{today.data ? nMist : '...'}</span><span class="bt-t"><b>Mistakes due</b><small>{nMist ? 'Questions to try again' : 'Nothing due right now'}</small></span>
          </button>
        </div>
        <section aria-label="Decks">
          <div class="row between deck-head"><h2 class="h">Decks</h2><button class="btn sm" onClick={() => go('cards/add')}><Icon.plus size={16} /> Add card</button></div>
          {cards.loading ? <Loading error={cards.error} retry={cards.reload} /> : withCards.length > 0 ? (
            <ul class="list card deck-list">
              {withCards.map((t) => <li><button class="lrow" onClick={() => go('cards/deck/' + t.id)}><span>{t.name}</span><small>{counts.get(t.id)} cards</small><Icon.chev size={18} /></button></li>)}
              {(cards.data ?? []).some((c) => !c.topic_id) && <li><button class="lrow" onClick={() => go('cards/deck/none')}><span>No topic</span><small>{(cards.data ?? []).filter((c) => !c.topic_id).length} cards</small><Icon.chev size={18} /></button></li>}
            </ul>
          ) : <Empty art="cards" title="No cards yet">Add your first card, or ask Claude to generate a deck.</Empty>}
        </section>
        <div class="more-links">
          <button class="btn sm" onClick={() => go('cards/game/pairs')}>Game: match pairs</button>
          <button class="btn sm" onClick={() => go('cards/game/recall')}>Game: timed recall</button>
          {insightsOn && <button class="btn sm" onClick={() => go('insights')}>Doubts</button>}
        </div>
      </main>
    </>
  )
}

function Deck({ topic }: { topic: string }) {
  const cards = useLoad(() => getCards(topic === 'none' ? undefined : topic).then((c) => (topic === 'none' ? c.filter((x) => !x.topic_id) : c)), [topic])
  const topics = useLoad(getTopics, [])
  const [open, setOpen] = useState<string | null>(null)
  const name = topics.data?.find((t) => t.id === topic)?.name ?? 'Deck'
  return (
    <>
      <Header title={name} onBack={() => go('cards')} sub="Tap a card to see its answer." right={<button class="icon-btn" aria-label="Add card" onClick={() => go('cards/add?topic=' + topic)}><Icon.plus /></button>} />
      <main class="page">
        {topic !== 'none' && <div class="more-links"><button class="btn sm" onClick={() => go('cards/game/pairs?topic=' + topic)}>Game: match pairs</button><button class="btn sm" onClick={() => go('cards/game/recall?topic=' + topic)}>Game: timed recall</button></div>}
        {cards.loading ? <Loading error={cards.error} retry={cards.reload} /> : (
          <ul class="list card">{(cards.data ?? []).map((c) => (
            <li><button class="lrow col" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
              <Md text={c.front} />{open === c.id && <div class="ans"><Md text={c.back} /></div>}
              <small>due {c.due_on ?? 'now'}</small>
            </button></li>))}
          </ul>
        )}
      </main>
    </>
  )
}

function AddCard({ topic }: { topic?: string }) {
  const topics = useLoad(getTopics, [])
  const [t, setT] = useState(topic && topic !== 'none' ? topic : ''); const [kind, setKind] = useState('qa')
  const [front, setFront] = useState(''); const [back, setBack] = useState(''); const [hint, setHint] = useState('')
  const save = async (more: boolean) => {
    try {
      const r = await addCard({ topic_id: t || null, kind, front: front.trim(), back: back.trim(), hint: hint.trim() || undefined })
      toast(isQueued(r) ? 'Saved offline' : 'Card added'); setFront(''); setBack(''); setHint(''); if (!more) navBack(() => go('cards'))
    } catch (e: any) { toast(e.message) }
  }
  const inp = (set: (v: string) => void) => (e: Event) => set((e.target as HTMLInputElement).value)
  return <Sheet title="Add card" onClose={() => navBack(() => go('cards'))}>
    <Field label="Topic"><select value={t} onChange={inp(setT)}><option value="">None</option>{(topics.data ?? []).map((x) => <option value={x.id}>{x.name}</option>)}</select></Field>
    <Seg value={kind} onChange={setKind} options={[["qa", "Q & A"], ["pair", "Pair (name / formula)"]]} />
    <Field label={kind === 'pair' ? 'Name' : 'Front'}><textarea rows={3} value={front} onInput={inp(setFront)} placeholder="Supports $math$" /></Field>
    <Field label={kind === 'pair' ? 'Formula' : 'Back'}><textarea rows={3} value={back} onInput={inp(setBack)} /></Field>
    <Field label="Hint (optional)"><input value={hint} onInput={inp(setHint)} /></Field>
    <div class="two"><button class="btn" disabled={!front.trim() || !back.trim()} onClick={() => save(true)}>Save and add another</button><button class="btn primary" disabled={!front.trim() || !back.trim()} onClick={() => save(false)}>Save</button></div>
  </Sheet>
}

const GRADES: [number, string, string][] = [[0, 'Again', 'again'], [3, 'Hard', 'hard'], [4, 'Good', 'good'], [5, 'Easy', 'easy']]

function Review() {
  const { data, error, loading, reload } = useLoad(() => getDueCards(5), [])
  const [i, setI] = useState(0); const [flip, setFlip] = useState(false)
  const [t0, setT0] = useState(Date.now()); const [stats, setStats] = useState({ again: 0, ok: 0 })
  useActiveStudy(data?.[i] ? data[i].topic_id || 'general.unsorted' : null)
  useEffect(() => { setFlip(false); setT0(Date.now()) }, [i])
  const exit = () => navBack(() => go('cards'))
  if (loading || !data) return <><Header title="Review" onBack={exit} menu={false} /><main class="page"><Loading error={error} retry={reload} /></main></>
  if (i >= data.length)
    return <><Header title="Review" onBack={exit} menu={false} /><main class="page"><Confetti fire={data.length > 0 && stats.ok > 0} /><Empty art={data.length ? 'trophy' : 'cards'} title={data.length ? 'Session complete' : 'No cards due'}>{data.length ? <>{stats.ok} remembered, {stats.again} coming back soon.</> : 'New cards appear here as they fall due.'}<br /><button class="btn primary" onClick={exit}>Back to Cards</button></Empty></main></>
  const c: Card = data[i]
  const grade = (g: number) => {
    reviewCard(c.id, g, Date.now() - t0).catch(() => toast('Could not save'))
    setStats((s) => (g < 3 ? { ...s, again: s.again + 1 } : { ...s, ok: s.ok + 1 }))
    setI(i + 1)
  }
  return (
    <>
      <Header title="Review" sub={`${i + 1} of ${data.length}`} onBack={exit} menu={false} />
      <main class="page review">
        <Bar pct={i / data.length} />
        <button class={cx('flash', flip && 'flipped')} onClick={() => setFlip(!flip)} aria-label={flip ? 'Showing answer' : 'Tap to reveal answer'}>
          <div class="face"><Md text={c.front} />{c.hint && !flip && <small class="muted">Hint: <Md text={c.hint}/></small>}</div>
          {flip ? <div class="face back"><Md text={c.back} /></div> : <small class="muted tap">Tap the card to flip it</small>}
        </button>
      </main>
      <div class="actionbar grades">
        {!flip ? <button class="btn primary grow" onClick={() => setFlip(true)}>Show answer</button> : GRADES.map(([g, l, cl]) => (
          <button class={'btn grade ' + cl} onClick={() => grade(g)}>
            <b>{l}</b><small>{ivLabel((c as any).next_intervals?.[g] ?? sm2Next(c.ease, c.interval_d, c.reps, g).interval)}</small>
          </button>
        ))}
      </div>
    </>
  )
}
