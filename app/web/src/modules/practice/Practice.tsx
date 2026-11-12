import { useMemo, useState } from 'preact/hooks'
import { useModules } from '../index'
import { getTopics, getBank, getAttempts, getMistakes, getBlueprint, getBookmarks, getMastery } from '../../api'
import { Header, Loading, useLoad, Seg, Bar, Icon, Empty, Sheet, Field, SubjIcon, SCOPE_NAME } from '../../ui'
import { cx, shuffle } from '../../util'
import { usePrefs, setPrefs } from '../../store'
import { go } from '../../router'
import { setQueue, startSession } from '../../queue'
import { useWeight, WChip, SortToggle, WFootnote } from '../../weight'
import { DoubtButton } from '../insights/DoubtButton'
import { byEase, buildPath, nextNode, sessionIds, LEVELS, type PNode } from './path'
import type { Q, Topic } from '../../types'
import { Md } from '../../md'

type Filter = 'all' | 'shared' | 'cs' | 'da' | 'ga'
interface Agg { total: number; done: number; correct: number }

export function useBank() {
  const bank = useLoad(() => getBank().catch(() => [] as Q[]), [])
  const att = useLoad(getAttempts, [])
  const { showOutside, showPre2017 } = usePrefs()
  const visible = bank.data && bank.data.filter((q) => (showOutside || !q.outside_syllabus) && (showPre2017 || !q.pre2017))
  return { bank: visible, all: bank.data, att: att.data, loading: bank.loading || att.loading, error: bank.error, reload: () => { bank.reload(); att.reload() } }
}

export function aggregate(topics: Topic[], bank: Q[] | undefined, att: Map<string, any> | undefined) {
  const kids = new Map<string | null, Topic[]>()
  topics.forEach((t) => { const k = t.parent_id; if (!kids.has(k)) kids.set(k, []); kids.get(k)!.push(t) })
  const direct = new Map<string, Agg>()
  for (const q of bank ?? []) {
    const a = direct.get(q.topic_id) ?? { total: 0, done: 0, correct: 0 }
    a.total++; const at = att?.get(q.id); if (at) { a.done++; if (at.correct) a.correct++ }
    direct.set(q.topic_id, a)
  }
  const agg = new Map<string, Agg>()
  const walk = (t: Topic): Agg => {
    const d = direct.get(t.id) ?? { total: 0, done: 0, correct: 0 }
    const a = { ...d }
    // fall back to server progress when we have no local bank
    if (!bank?.length && t.progress) { a.done = t.progress.questions_done ?? 0; a.correct = t.progress.questions_correct ?? 0; a.total = t.question_count ?? a.done }
    for (const c of kids.get(t.id) ?? []) { const x = walk(c); a.total += x.total; a.done += x.done; a.correct += x.correct }
    agg.set(t.id, a); return a
  }
  ;(kids.get(null) ?? []).forEach(walk)
  return { kids, agg }
}
export const subtreeIds = (kids: Map<string | null, Topic[]>, id: string) => { const s = new Set<string>(); const w = (x: string) => { s.add(x); (kids.get(x) ?? []).forEach((c) => w(c.id)) }; w(id); return s }

const plainTeX = (s: string) => s.replace(/\$/g, '').replace(/\\begin\{[^}]*\}[\s\S]*?\\end\{[^}]*\}/g, '[matrix]').replace(/\\mid/g, '|').replace(/\\cap/g, '∩').replace(/\\cup/g, '∪').replace(/\\(?:leq?|le)\b/g, '≤').replace(/\\(?:geq?|ge)\b/g, '≥').replace(/\\neq?\b/g, '≠').replace(/\\(?:to|rightarrow)\b/g, '→').replace(/\\infty/g, '∞').replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)').replace(/\\times/g, '×').replace(/\\(?:cdot|ldots|dots)/g, '·')
  .replace(/\\(?:operatorname|mathrm|text)\{([^}]*)\}/g, '$1').replace(/\\([a-zA-Z]+)/g, '$1').replace(/[{}]/g, '').replace(/\*\*|`|^\s*- /gm, '').replace(/\s+/g, ' ').trim()
export const qLabel = (q: Q) => (q.source === 'official' ? `${q.year ?? ''} ${q.paper ?? ''}${q.session && q.session !== q.paper ? ' ' + q.session : ''} Q${q.q_no ?? ''}`.trim() : ((q.level ? `Level ${q.level}: ` : '') + plainTeX(q.stem).slice(0, 52) + (plainTeX(q.stem).length > 52 ? '...' : '')))
export const typeName = (t: string) => (t === 'MCQ' ? 'Multiple choice' : t === 'MSQ' ? 'Select all that apply' : t === 'NAT' ? 'Numerical answer' : t)
export const qTitle = (q: Q) => (q.source === 'official' ? qLabel(q) : q.level ? `Ladder level ${q.level}` : 'Practice question')

/** Practice home: subjects grouped by paper, each a unit card with progress and a one-tap "Continue" into a short session. */
export function Practice() {
  const topics = useLoad(getTopics, [])
  const { bank, att } = useBank()
  const [f] = useState<Filter>('all')
  const w = useWeight(); const { sortW } = usePrefs()
  const { kids, agg } = useMemo(() => aggregate(topics.data ?? [], bank, att), [topics.data, bank, att])
  const byId = useMemo(() => new Map((bank ?? []).map((q) => [q.id, q])), [bank])
  const solved = (q: Q) => !!att?.get(q.id)?.correct

  const roots = (kids.get(null) ?? []).filter((t) => f === 'all' || t.scope === f)
  const sortBy = (ts: Topic[], root: boolean) => (sortW ? [...ts].sort((a, b) => w.score(b.id, root) - w.score(a.id, root)) : ts)
  const groups = (['shared', 'cs', 'da', 'ga'] as const).map((sc) => [sc, sortBy(roots.filter((t) => t.scope === sc), true)] as const).filter(([, ts]) => ts.length)

  const cont = (t: Topic) => {
    const ids = subtreeIds(kids, t.id)
    const qs = (bank ?? []).filter((q) => ids.has(q.topic_id))
    const nodes = buildPath(qs, solved), n = nextNode(nodes)
    return { nodes, n, qs }
  }
  const startNode = (t: Topic, n: PNode) => {
    const ids = sessionIds(n, byId, solved)
    if (!ids.length) return go('practice/' + t.id)
    startSession(ids, `${t.name}: ${n.kind === 'level' ? 'level ' + n.level : n.title}`, 'practice/' + t.id)
    go('q/' + ids[0])
  }
  // the one card at the top: the subject you started, else the first one with questions
  const all = groups.flatMap(([, ts]) => ts)
  const pick = all.find((t) => { const a = agg.get(t.id); return a && a.done > 0 && a.done < a.total && cont(t).n }) ?? all.find((t) => (agg.get(t.id)?.total ?? 0) > 0 && cont(t).n)
  const pn = pick ? cont(pick).n : undefined
  const pa = pick ? agg.get(pick.id) : undefined
  const nodeName = (n: PNode) => (n.kind === 'level' ? `Level ${n.level}: ${LEVELS[(n.level ?? 1) - 1]}` : n.title)

  return (
    <>
      <Header title="Practice" sub="Pick a chapter and practise in short sets." />
      <main class="page">
        {pick && pn && pa && (
          <section class="card cont" aria-label="Continue practising">
            <small>{pa.done > 0 ? 'Continue where you left off' : 'Start here'}</small>
            <h2>{pick.name}</h2>
            <p class="muted">{nodeName(pn)} {'·'} {pa.done} of {pa.total} solved</p>
            <button class="btn primary block" onClick={() => startNode(pick, pn)}>{pa.done > 0 ? 'Continue' : 'Start'}</button>
          </section>
        )}
        {topics.loading ? <Loading error={topics.error} retry={topics.reload} /> : groups.map(([sc, ts]) => (
          <section class="subj" aria-label={SCOPE_NAME[sc]}>
            <h2 class="subj-h"><i /> {SCOPE_NAME[sc]}</h2>
            <ul class={'list card u-' + sc}>
              {ts.map((t) => {
                const a = agg.get(t.id)
                const pct = a && a.total ? a.done / a.total : 0
                const done = cont(t).n?.state === 'done' && a && a.total > 0 && a.done >= a.total
                return (
                  <li><button class="lrow col" onClick={() => go('practice/' + t.id)}>
                    <span class="row between gap"><b>{t.name}{done && <span class="crown inl" role="img" aria-label="Mastered"><Icon.crown size={18} /></span>}</b><Icon.chev size={18} /></span>
                    <small>{a?.done ? `${a.done} of ${a.total} solved` : `${a?.total ?? 0} questions`}</small>
                    {pct > 0 && <Bar pct={pct} label={`${t.name} progress`} />}
                    <span><WChip w={w} id={t.id} root /></span>
                  </button></li>
                )
              })}
            </ul>
          </section>
        ))}
        {!topics.loading && roots.length === 0 && <Empty art="empty" title="No topics here">There are no practice topics yet.</Empty>}
        <div class="more-links">
          <button class="btn sm" onClick={() => go('drill')}>Speed drill</button>
          <button class="btn sm" onClick={() => go('priority')}>Where to spend your hours</button>
          {w.ready && <SortToggle />}
        </div>
        <WFootnote w={w} />
      </main>
    </>
  )
}

type Mode = 'path' | 'free' | 'mistakes'
type St = 'all' | 'new' | 'wrong' | 'starred'

function QRow({ q, a, onOpen, next }: { q: Q; a?: { correct: boolean }; onOpen: () => void; next?: boolean }) {
  return (
    <li>
      <button class={cx('qrow', next && 'next')} onClick={onOpen}>
        <span class={cx('mark', !a ? 'none' : a.correct ? 'ok' : 'bad')} aria-label={!a ? 'Unattempted' : a.correct ? 'Correct' : 'Wrong'}>{a ? (a.correct ? '✓' : '✗') : ''}</span>
        <span class="qt">{q.source === 'official' ? qLabel(q) : <><span class="tag">{q.level ? 'Level ' + q.level : 'Practice'}</span><Md text={q.stem}/></>}
          {(q.needs_review || !q.has_key) && <i class="flagi" title={q.has_key ? 'Needs review' : 'No answer key yet'}><Icon.flag size={13} /></i>}
          {q.answer_check === 'disagrees' && <i class="flagi bad" title="Our re-solve disagrees with the key"><Icon.flag size={13} /></i>}
          {q.outside_syllabus && <small class="tag outside">outside syllabus</small>}
        </span>
        <span class="qm"><span class="diff" aria-label={`Difficulty ${q.difficulty}`}>{'●'.repeat(q.difficulty)}<s>{'●'.repeat(5 - q.difficulty)}</s></span><small>{typeName(q.type)} {'\u00b7'} {q.marks} mark{q.marks === 1 ? '' : 's'}</small></span>
      </button>
    </li>
  )
}

const X = [0, 46, 70, 46, 0, -46, -70, -46]
function PathView({ nodes, color, onOpen }: { nodes: PNode[]; color: string; onOpen: (n: PNode) => void }) {
  const firstPyq = nodes.findIndex((n) => n.kind === 'pyq')
  return (
    <ol class={'path ' + color} aria-label="Learning path">
      {nodes.map((n, i) => {
        const x = X[i % X.length]
        const locked = n.state === 'locked'
        const label = `${n.kind === 'level' ? `Level ${n.level}, ${n.title}` : n.title}: ${n.sub}${n.state === 'current' ? '. Start here' : ''}${n.state === 'done' ? '. Completed' : ''}${locked ? '. Locked' : ''}`
        return (
          <li class="pstep-wrap" style={{ display: 'contents' }}>
            {i === firstPyq && <div class="path-sep" role="presentation">Past papers, easy to hard</div>}
            <div class={cx('pstep', n.state === 'current' && 'has-tip')} style={{ '--x': x + 'px' } as any}>
              <button class={cx('pnode', n.state)} aria-disabled={locked} aria-label={label} onClick={() => { if (!locked) onOpen(n) }}>
                {n.state === 'current' && <span class="start-tip" aria-hidden="true">Start</span>}
                {n.kind === 'crown' ? <Icon.crown size={34} /> : locked ? <Icon.lock size={28} /> : n.state === 'done' ? <Icon.check size={34} /> : n.kind === 'level' ? <span class="pnode-in">{n.level}</span> : <Icon.book size={30} />}
              </button>
              <span class="plabel"><b>{n.kind === 'level' ? 'Level ' + n.level : n.title}</b><small>{n.kind === 'level' ? n.title + ' · ' + n.sub : n.sub}</small></span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function TopicPage({ id, query }: { id: string; query?: URLSearchParams }) {
  const learnEnabled = useModules().some((m) => m.id === 'learn' && m.enabled)
  const topics = useLoad(getTopics, [])
  const { bank, all, att, loading, error, reload } = useBank()
  const { showOutside } = usePrefs()
  const mist = useLoad(() => getMistakes(false).catch(() => []), [])
  const mastery = useLoad(getMastery, [])
  const atom = query?.get('atom') || ''
  const bp = useLoad(() => getBlueprint(id).catch(() => null), [id])
  const [modeSel, setMode] = useState<Mode>(query?.get('mode') === 'free' ? 'free' : 'path')
  const [year, setYear] = useState('all'); const [diff, setDiff] = useState('all'); const [st, setSt] = useState<St>('all'); const [src, setSrc] = useState(query?.get('source') === 'pyq' ? 'pyq' : 'all'); const [typ, setTyp] = useState('all')
  const [shuf, setShuf] = useState(0); const [filtersOpen, setFiltersOpen] = useState(false)
  const w = useWeight(); const { sortW } = usePrefs()
  const bms = useLoad(getBookmarks, [])

  const topic = topics.data?.find((t) => t.id === id)
  const { kids, agg } = useMemo(() => aggregate(topics.data ?? [], bank, att), [topics.data, bank, att])
  const ids = useMemo(() => subtreeIds(kids, id), [kids, id])
  const inScope = (bank ?? []).filter((q) => ids.has(q.topic_id) && (!atom || q.atoms?.includes(atom)))
  const byId = useMemo(() => new Map((bank ?? []).map((q) => [q.id, q])), [bank])
  const hiddenCount = (all ?? []).filter((q) => ids.has(q.topic_id) && q.outside_syllabus).length
  const years = [...new Set(inScope.filter((q) => q.year).map((q) => q.year!))].sort((a, b) => b - a)
  const solved = (q: Q) => !!att?.get(q.id)?.correct
  const subjectScore = (id:string) => { const xs=(mastery.data?.chapters??[]).filter((x:any)=>topics.data?.find(t=>t.id===x.topic_id)?.subject_id===id); return xs.length?Math.round(xs.reduce((n:number,x:any)=>n+x.score,0)/xs.length):0 }
  const nodes = useMemo(() => buildPath(inScope, solved), [inScope.length, att, atom, id])
  const a = agg.get(id)
  const pctDone = inScope.length ? inScope.filter(solved).length / inScope.length : 0
  const parent = topic?.parent_id ? topics.data?.find((t) => t.id === topic.parent_id) : undefined
  const chapters = sortW ? [...(kids.get(id) ?? [])].sort((a, b) => w.score(b.id, false) - w.score(a.id, false)) : (kids.get(id) ?? [])
  const atomName = atom ? bp.data?.atoms?.find((x) => x.id === atom)?.name : undefined

  let list = inScope
  if (modeSel === 'mistakes') { const m = new Set((mist.data ?? []).map((x) => x.question_id)); list = list.filter((q) => m.has(q.id)) }
  if (src === 'ladder') list = list.filter((q) => q.source !== 'official'); else if (src === 'pyq') list = list.filter((q) => q.source === 'official' && !q.pre2017); else if (src === 'old') list = list.filter((q) => q.pre2017)
  if (typ !== 'all') list = list.filter((q) => q.type === typ)
  if (year !== 'all') list = list.filter((q) => String(q.year) === year)
  if (diff !== 'all') { const [x, y] = diff.split('-').map(Number); list = list.filter((q) => q.difficulty >= x && q.difficulty <= y) }
  if (st === 'new') list = list.filter((q) => !att?.has(q.id))
  if (st === 'starred') list = list.filter((q) => bms.data?.has(q.id))
  if (st === 'wrong') list = list.filter((q) => att?.get(q.id) && !att.get(q.id)!.correct)
  list = shuf ? shuffle(list) : [...list].sort(byEase)

  const back = 'practice/' + id + (atom ? '?atom=' + atom : '')
  const openNode = (n: PNode) => {
    if (n.kind === 'crown') return
    const s = sessionIds(n, byId, solved)
    if (!s.length) return
    startSession(s, `${topic?.name ?? 'Practice'}: ${n.kind === 'level' ? 'level ' + n.level : n.title}`, back)
    go('q/' + s[0])
  }
  const open = (q: Q, order: Q[]) => { const i = order.findIndex((x) => x.id === q.id); setQueue(order.slice(Math.max(0, i), Math.max(0, i) + 15).map((x) => x.id)); go('q/' + q.id) }
  const scope = topic?.scope ?? 'shared'

  const filtersOn = [src, typ, year, diff, st].filter((x) => x !== 'all').length + (atom ? 1 : 0) + (shuf ? 1 : 0)
  const startNext = list.find((q) => !att?.has(q.id))
  const mscore = (mastery.data?.chapters ?? []).find((x: any) => x.topic_id === id)?.score ?? 0

  return (
    <>
      <Header title={topic?.name ?? 'Topic'} onBack={() => go(parent ? 'practice/' + parent.id : 'practice')} sub="Work up from basics to past papers." />
      <main class={'page topic u-' + scope}>
        <section class="psum" aria-label="Chapter progress">
          <div class="ucard-s"><Bar pct={pctDone} label="Solved" /><small>{inScope.filter(solved).length} of {inScope.length} solved</small></div>
          <div class="more-links">
            {learnEnabled && <button class="btn sm" onClick={() => go('learn/' + id)}><Icon.book size={16} /> Read the concepts</button>}
            {atom && <button class="btn sm" onClick={() => go('practice/' + id)}>Concept: {atomName ?? 'selected'} {'✕'}<span class="sr"> Show the whole chapter</span></button>}
          </div>
        </section>

        {chapters.length > 0 && (
          <section aria-label="Chapters">
            <div class="row between"><h2 class="h">Chapters</h2>{w.ready && <SortToggle />}</div>
            <ul class="list card">{chapters.map((c) => { const g = agg.get(c.id); return (
              <li><button class="lrow" onClick={() => go('practice/' + c.id)}><span>{c.name} <WChip w={w} id={c.id} root={false} /></span><small>{g?.done ?? 0} of {g?.total ?? 0}</small><Icon.chev size={18} /></button></li>
            ) })}</ul>
          </section>
        )}

        <Seg<Mode> value={modeSel} onChange={setMode} options={[['path', 'Path'], ['free', 'All questions'], ['mistakes', 'Mistakes']]} />

        {loading ? <Loading error={error} retry={reload} /> : modeSel === 'path' ? (
          inScope.length === 0 ? <Empty art="empty" title="No questions here yet">Nothing has been added for this scope. Try the whole chapter.</Empty>
            : <PathView nodes={nodes} color={'u-' + scope} onOpen={openNode} />
        ) : (
          <>
            <div class="row between gap">
              <small class="muted">{list.length} question{list.length === 1 ? '' : 's'}{shuf ? ', shuffled' : ', easiest first'}</small>
              <span class="row gap">
                {modeSel === 'free' && <button class="btn sm" onClick={() => setFiltersOpen(true)}>Filters{filtersOn > 0 && <span class="badge-n" aria-label={`${filtersOn} filter${filtersOn === 1 ? '' : 's'} on`}>{filtersOn}</span>}</button>}
                {startNext && <button class="btn sm primary" onClick={() => open(startNext, list)}>Start next</button>}
              </span>
            </div>
            <ul class="qlist card">{list.map((q) => <QRow q={q} a={att?.get(q.id)} onOpen={() => open(q, list)} />)}</ul>
            {list.length === 0 && <Empty art="empty" title={inScope.length ? 'No matches' : 'No questions yet'}>{inScope.length ? (modeSel === 'mistakes' ? 'Questions you get wrong will collect here for revision.' : 'Open Filters and loosen one to see more.') : 'Nothing has been added to this topic yet.'}</Empty>}
          </>
        )}

        <details class="more-about">
          <summary>About this chapter</summary>
          <div class="more-body">
            {mscore > 0 && <p>Your mastery: <b>{mscore}%</b></p>}
            {a && a.done > 0 && <p>Accuracy so far: <b>{Math.round((a.correct / a.done) * 100)}%</b></p>}
            {topic && <p><WChip w={w} id={id} root={!topic.parent_id} /></p>}
            <DoubtButton refType="chapter" refId={id} />
          </div>
        </details>
      </main>
      {filtersOpen && (
        <Sheet title="Filters" onClose={() => setFiltersOpen(false)}>
          <Field label="Where from"><select value={src} onChange={(e) => setSrc((e.target as HTMLSelectElement).value)}><option value="all">Everything</option><option value="ladder">Practice questions</option><option value="pyq">Past papers, 2017 onwards</option><option value="old">Past papers before 2017</option></select></Field>
          <Field label="Question type"><select value={typ} onChange={(e) => setTyp((e.target as HTMLSelectElement).value)}><option value="all">Any type</option><option value="MCQ">Multiple choice (one answer)</option><option value="MSQ">Select all that apply</option><option value="NAT">Numerical answer</option></select></Field>
          {years.length > 0 && <Field label="Year"><select value={year} onChange={(e) => setYear((e.target as HTMLSelectElement).value)}><option value="all">Any year</option>{years.map((y) => <option value={y}>{y}</option>)}</select></Field>}
          <Field label="Difficulty"><select value={diff} onChange={(e) => setDiff((e.target as HTMLSelectElement).value)}><option value="all">Any difficulty</option><option value="1-2">Easy</option><option value="3-3">Medium</option><option value="4-5">Hard</option></select></Field>
          <Field label="Your progress"><select value={st} onChange={(e) => setSt((e.target as HTMLSelectElement).value as St)}><option value="all">All questions</option><option value="new">Not tried yet</option><option value="wrong">Got wrong before</option><option value="starred">Saved by you</option></select></Field>
          {!chapters.length && (bp.data?.atoms?.length ?? 0) > 0 && <Field label="Concept"><select value={atom} onChange={(e) => go('practice/' + id + ((e.target as HTMLSelectElement).value ? '?atom=' + (e.target as HTMLSelectElement).value : ''), true)}><option value="">All concepts</option>{bp.data!.atoms!.map((x) => <option value={x.id}>{x.name}</option>)}</select></Field>}
          <label class="toggle compact"><span>Shuffle the order</span><input type="checkbox" checked={!!shuf} onChange={() => setShuf(shuf ? 0 : Date.now())} /><i /></label>
          {hiddenCount > 0 && <label class="toggle compact"><span>Include {hiddenCount} questions outside the 2027 syllabus</span><input type="checkbox" checked={showOutside} onChange={() => setPrefs({ showOutside: !showOutside })} /><i /></label>}
          <div class="two sheet-btns"><button class="btn" onClick={() => { setSrc('all'); setTyp('all'); setYear('all'); setDiff('all'); setSt('all'); setShuf(0) }}>Clear all</button><button class="btn primary" onClick={() => setFiltersOpen(false)}>Show {list.length}</button></div>
        </Sheet>
      )}
    </>
  )
}
