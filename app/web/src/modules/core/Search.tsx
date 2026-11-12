import { useEffect, useState } from 'preact/hooks'
import { search, type SearchResults } from '../../api'
import { go } from '../../router'
import { Header } from '../../ui'

function Highlight({ text, q }: { text: string; q: string }) {
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  const start = Math.max(0, at - 45), end = Math.min(text.length, Math.max(at + q.length + 45, 100))
  const s = text.slice(start, end).replace(/\s+/g, ' ')
  const i = at < 0 ? -1 : text.slice(start, at).replace(/\s+/g, ' ').length
  return <>{start ? '…' : ''}{i < 0 ? s : <>{s.slice(0, i)}<b>{s.slice(i, i + q.length)}</b>{s.slice(i + q.length)}</>}{end < text.length ? '…' : ''}</>
}

export default function Search({ query }: { query: URLSearchParams }) {
  const initial = query.get('q') ?? ''
  const [q, setQ] = useState(initial), [results, setResults] = useState<SearchResults | null>(null)
  const [state, setState] = useState(initial.trim().length >= 2 ? 'Searching…' : '')
  useEffect(() => { if (initial !== q) setQ(initial) }, [initial])
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      go('search' + (q ? '?q=' + encodeURIComponent(q) : ''), true)
      if (q.trim().length < 2) { setResults(null); setState(''); return }
      setState('Searching…')
      search(q.trim()).then(r => { if (live) { setResults(r); setState('') } }).catch(() => { if (live) { setResults(null); setState('Offline. Try again.')}})
    }, 200)
    return () => { live = false; clearTimeout(timer) }
  }, [q])
  const groups = results ? [
    ['Chapters', results.chapters.map(x => ({ key: x.id, title: x.name, snippet: '', route: 'learn/' + x.id }))],
    ['Concepts', results.concepts.map(x => ({ key: x.topic_id + '/' + x.atom_id, title: x.name, snippet: x.snippet || x.topic_name, route: `learn/${x.topic_id}/${x.atom_id}` }))],
    ['Questions', results.questions.map(x => ({ key: x.id, title: x.topic_name, snippet: x.snippet, route: 'q/' + x.id }))],
  ] as const : []
  return <><Header title="Search" sub="Find a chapter, concept or question." onBack menu={false} />
    <main class="page search-page">
      <input type="search" aria-label="Search" placeholder="Search" autoFocus value={q} onInput={e => { setQ((e.target as HTMLInputElement).value); setState('Searching…') }} />
      {q.trim().length < 2 ? <p class="muted">Type at least 2 letters.</p> : state ? <p class="muted" role="status">{state}</p> : groups.every(([, items]) => !items.length) ? <p class="muted">No matches.</p> : groups.map(([heading, items]) => items.length > 0 && <section><h2>{heading}</h2><ul class="list card">{items.map(item => <li key={item.key}><button class="lrow col" onClick={() => go(item.route)}><b><Highlight text={item.title} q={q.trim()} /></b>{item.snippet && <small><Highlight text={item.snippet} q={q.trim()} /></small>}</button></li>)}</ul></section>)}
    </main></>
}
