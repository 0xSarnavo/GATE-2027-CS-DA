import { lazy, Suspense } from 'preact/compat'
import { useState } from 'preact/hooks'
import { createTest, getPapers, getTests, getTopics, getWeak } from '../../api'
import { Header, Loading, useLoad, Chips, Icon, Empty, Sheet, toast } from '../../ui'
import { fmtDate } from '../../util'
import { go } from '../../router'
import type { TestKind } from '../../types'

const Runner = lazy(() => import('./Runner'))
const Result = lazy(() => import('./Result'))

/** Test tab: timed, exam-like. Quick tests, topic sets, PYQ papers and the full mock. */
export default function Test({ parts, query }: { parts: string[]; query: URLSearchParams }) {
  const [a, b] = parts
  if (a === 'run' && b) return <Suspense fallback={<Loading />}><Runner id={b} /></Suspense>
  if (a === 'result' && b) return <Suspense fallback={<Loading />}><Result id={b} /></Suspense>
  return <TestHome query={query} />
}

export async function begin(kind: TestKind, scope: Record<string, unknown>, count?: number) {
  const t = await createTest(kind, scope, count)
  if (t.short) toast(`Only ${t.questions.length} question${t.questions.length === 1 ? '' : 's'} available for this scope`)
  go('test/run/' + t.id)
}

function TestHome({ query }: { query: URLSearchParams }) {
  const topics = useLoad(getTopics, [])
  const papers = useLoad(() => getPapers().catch(() => []), [])
  const recent = useLoad(() => getTests().catch(() => []), [])
  const weak = useLoad(() => getWeak().catch(() => []), [])
  const initialCount = Number(query.get('count'))
  const [count, setCount] = useState(String(Number.isInteger(initialCount) && initialCount >= 5 && initialCount <= 65 ? initialCount : 10))
  const [scope, setScope] = useState(query.get('subject') === 'ga' ? 's:ga' : 'weak')
  const [busy, setBusy] = useState('')
  const [sheet, setSheet] = useState<'quick' | 'paper' | 'mock' | null>(['quick', 'paper', 'mock'].includes(query.get('setup') || '') ? query.get('setup') as 'quick' | 'paper' | 'mock' : null)
  const roots = (topics.data ?? []).filter((t) => !t.parent_id)
  const leaves = (topics.data ?? []).filter((t) => t.parent_id)
  const run = async (key: string, fn: () => Promise<void>) => { if (busy) return; setBusy(key); try { await fn() } catch (e: any) { toast(e?.message || 'Could not start the test') } setBusy('') }
  const quick = () => run('quick', () => {
    const preset = query.get('setup') === 'quick' ? { task_preset: true } : {}
    return scope.startsWith('t:') ? (query.get('setup') === 'quick' ? begin('quick', { topic_id: scope.slice(2), ...preset }, +count) : begin('topic', { topic_id: scope.slice(2) }, +count))
      : begin('quick', { ...(scope === 'weak' ? { weak: true } : scope === 'all' ? {} : { subject: scope.slice(2) }), ...preset }, +count)
  })
  const done = ((recent.data ?? []) as any[]).filter((x) => x.submitted_at).slice(0, 5)
  const KIND: Record<string, string> = { quick: 'Quick test', topic: 'Chapter test', pyq: 'Past paper', mock: 'Full mock' }
  const paperChoices = (papers.data ?? []).filter((p: any) => !query.get('paper') || p.paper === query.get('paper'))
  const nPapers = paperChoices.length
  return (
    <>
      <Header title="Test" sub="Timed tests with real GATE marking." />
      <main class="page">
        <div class="bigtiles">
          <button class="bigtile primary" onClick={() => setSheet('quick')}><span class="bt-ic"><Icon.bolt size={28} /></span><span class="bt-t"><b>Quick test</b><small>5 to 65 questions, timed, from the chapters you choose.</small></span><Icon.chev size={20} /></button>
          <button class="bigtile" onClick={() => setSheet('paper')}><span class="bt-ic"><Icon.clock size={28} /></span><span class="bt-t"><b>Past paper</b><small>A real GATE paper: same questions, same order, 3 hours.</small></span><Icon.chev size={20} /></button>
          <button class="bigtile" onClick={() => setSheet('mock')}><span class="bt-ic"><Icon.trophy size={28} /></span><span class="bt-t"><b>Full mock</b><small>65 questions picked like the real exam, 3 hours.</small></span><Icon.chev size={20} /></button>
        </div>
        {done.length > 0 && (
          <section aria-label="Recent results">
            <h2>Recent results</h2>
            <ul class="list card">
              {done.map((x) => (
                <li><button class="lrow" onClick={() => go('test/result/' + x.id)}><span><b>{KIND[x.kind] ?? x.kind}</b><small class="concept-line">{fmtDate(x.submitted_at.slice(0, 10))}</small></span>
                  <b class="score-sm">{Math.round(x.score * 10) / 10} out of {x.max_score}</b><Icon.chev size={18} /></button></li>
              ))}
            </ul>
          </section>
        )}
      </main>
      {sheet === 'quick' && (
        <Sheet title="Quick test" onClose={() => setSheet(null)}>
          <p class="muted">Random questions with GATE marking and a timer.</p>
          <div class="field"><span id="qcount">How many questions?</span><div aria-labelledby="qcount"><Chips value={count} onChange={setCount} options={[['5', '5'], ['10', '10'], ['15', '15'], ['20', '20'], ...(!['5', '10', '15', '20'].includes(count) ? [[count, count] as [string, string]] : [])]} /></div></div>
          <label class="field"><span>Questions from</span>
            <select value={scope} onChange={(e) => setScope((e.target as HTMLSelectElement).value)}>
              <option value="weak">My weaker chapters{(weak.data?.length ?? 0) ? ` (${weak.data!.length} chapters)` : ''}</option>
              <option value="all">Everything</option>
              <optgroup label="One subject">{roots.map((t) => <option value={'s:' + t.id}>{t.name}</option>)}</optgroup>
              <optgroup label="One chapter">{leaves.map((t) => <option value={'t:' + t.id}>{t.name}</option>)}</optgroup>
            </select>
          </label>
          <button class="btn primary block" disabled={!!busy} onClick={quick}>{busy === 'quick' ? 'Preparing...' : `Start ${count} questions`}</button>
        </Sheet>
      )}
      {sheet === 'paper' && (
        <Sheet title="Choose a past paper" onClose={() => setSheet(null)}>
          {papers.loading ? <Loading /> : nPapers === 0 ? <Empty art="empty" title="No full papers yet">Papers appear here once a year has its complete question set.</Empty> : (
            <ul class="list">
              {paperChoices.map((p: any) => (
                <li><button class="lrow" disabled={!!busy} onClick={() => run('p' + p.year + p.session, () => begin('pyq', { year: p.year, paper: p.paper, session: p.session }))}>
                  <span><b>{p.year} {p.session}</b><small class="concept-line">{p.n} questions</small></span><Icon.chev size={18} /></button></li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
      {sheet === 'mock' && (
        <Sheet title="Full mock" onClose={() => setSheet(null)}>
          <p class="muted">65 questions (10 General Aptitude and 55 from your subject), picked by how often GATE asks each topic. You get 3 hours, a question list, mark for review and a calculator.</p>
          <div class="two">
            {(!query.get('paper') || query.get('paper') === 'CS') && <button class="btn primary" disabled={!!busy} onClick={() => run('mockCS', () => begin('mock', { paper: 'CS' }))}>{busy === 'mockCS' ? '...' : 'Computer Science'}</button>}
            {(!query.get('paper') || query.get('paper') === 'DA') && <button class="btn primary" disabled={!!busy} onClick={() => run('mockDA', () => begin('mock', { paper: 'DA' }))}>{busy === 'mockDA' ? '...' : 'Data Science and AI'}</button>}
          </div>
        </Sheet>
      )}
    </>
  )
}
