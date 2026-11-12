import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useActiveStudy } from '../../active-time'
import { getTopics, getConcepts, getConceptProgress, setConcept, getBlueprint, getExplainer, getCards, getNote, putNote, getMastery, getMistakes, getBookmarks, getBank, isQueued, getPrereqs, getReadiness, submitReadiness } from '../../api'
import type { ReadinessResult } from '../../api'
import { Header, Loading, useLoad, Bar, Icon, Empty, toast, CopySearch, Sheet } from '../../ui'
import { Layered, Md } from '../../md'
import { ConceptBody } from '../../anim'
import type { ExplainerFile, Scene } from '../../anim'
import { usePrefs, setPrefs } from '../../store'
import { go, back as navBack, setTopicParents } from '../../router'
import { cx } from '../../util'
import { startSession, setQueue } from '../../queue'
import { subtreeIds, aggregate, qLabel } from '../practice/Practice'
import { useWeight, WChip, SortToggle, WFootnote } from '../../weight'
import { byEase } from '../practice/path'
import { useModules } from '../index'
import { DoubtButton } from '../insights/DoubtButton'
import type { Topic } from '../../types'
import { VideoCatalog, VideoCourse, ConceptVideos } from './VideoCatalog'

/** Learn: Subject -> Chapter -> Concept. Concepts are the blueprint atoms of a chapter. */
export default function Learn({ parts }: { parts: string[]; query: URLSearchParams }) {
  const [a, b] = parts
  if (!a) return <LearnHome />
  if (a === 'bookmarks') return <Bookmarks />
  if (a === 'notes') return <NotesList />
  if (a === 'sheet') return <RevisionSheet subject={b || ''} />
  if (a === 'course') return <VideoCourse subject={b || ''} />
  if (a === 'readiness') return <ReadinessPage chapter={b || ''} />
  if (b) return <ConceptPage topic={a} atom={b} />
  return <TopicLearn id={a} />
}

function useLearnData() {
  const topics = useLoad(getTopics, [])
  useEffect(() => {
    if (topics.data) {
      const parents = new Map(topics.data.map((t) => [t.id, t.parent_id]))
      setTopicParents((id) => parents.get(id))
    }
  }, [topics.data])
  const concepts = useLoad(getConcepts, [])
  const prog = useLoad(getConceptProgress, [])
  const kids = useMemo(() => aggregate(topics.data ?? [], undefined, undefined).kids, [topics.data])
  const stat = (id: string) => {
    const ids = subtreeIds(kids, id)
    const cs = (concepts.data?.items ?? []).filter((c) => ids.has(c.topic_id))
    return { total: cs.length, got: cs.filter((c) => prog.data?.get(c.topic_id + '/' + c.atom_id) === 'got_it').length }
  }
  /** first concept (in list order) inside a subtree that is not learned yet */
  const nextIn = (id: string) => {
    const ids = subtreeIds(kids, id)
    return (concepts.data?.items ?? []).find((c) => ids.has(c.topic_id) && prog.data?.get(c.topic_id + '/' + c.atom_id) !== 'got_it')
  }
  return { topics, concepts, prog, kids, stat, nextIn, loading: topics.loading }
}

/** The one big card at the top of a Learn screen. */
function ContinueCard({ eyebrow, title, line, cta, onGo, pct, progress, primary = true }: { eyebrow: string; title: string; line?: string; cta: string; onGo: () => void; pct?: number; progress?: string; primary?: boolean }) {
  return (
    <section class="card cont" aria-label={eyebrow}>
      <small>{eyebrow}</small>
      <h2>{title}</h2>
      {line && <p class="muted"><Md text={line} /></p>}
      {pct !== undefined && <div class="ucard-s"><Bar pct={pct} label="Concepts learned" /><small>{progress}</small></div>}
      <button class={cx('btn block', primary && 'primary')} onClick={onGo}>{cta}</button>
    </section>
  )
}

function LearnHome() {
  const d = useLearnData()
  const w = useWeight(); const { sortW } = usePrefs()
  const mastery = useLoad(() => getMastery().catch(() => null), [])
  const roots = d.kids.get(null) ?? []
  const groups = (['shared', 'cs', 'da', 'ga'] as const).map((sc) => { const ts = roots.filter((t) => t.scope === sc); return [sc, sortW ? [...ts].sort((a, b) => w.score(b.id, true) - w.score(a.id, true)) : ts] as const }).filter(([, ts]) => ts.length)
  const sn = mastery.data?.study_next
  const foundations = (d.kids.get('found') ?? []).filter((t) => d.concepts.data?.items.some((c) => c.topic_id === t.id))
  const firstFoundation = foundations.find((t) => d.stat(t.id).got < d.stat(t.id).total) ?? foundations[0]
  const openConcepts = (d.concepts.data?.items ?? []).filter((c) => d.prog.data?.get(c.topic_id + '/' + c.atom_id) !== 'got_it')
  const first = foundations.map((t) => openConcepts.find((c) => c.topic_id === t.id)).find(Boolean) ?? openConcepts[0]
  const next = sn ? { topic: sn.topic_id as string, atom: sn.atom_id as string, name: sn.atom_name as string, where: sn.topic_name as string } : first ? { topic: first.topic_id, atom: first.atom_id, name: first.name, where: d.topics.data?.find((t) => t.id === first.topic_id)?.name ?? '' } : null
  return (
    <>
      <Header title="Learn" sub="Read a concept, then try a question." />
      <main class="page">
        {next && <ContinueCard eyebrow="Up next" title={next.name} line={next.where} cta="Start concept" onGo={() => go(`learn/${next.topic}/${next.atom}`)} />}
        {foundations.length > 0 && <section class="foundation-overview" aria-label="Foundations">
          <span class="section-kicker">Build your base</span>
          <h2>Foundations</h2>
          <p>Short lessons to make the GATE chapters easier.</p>
          <button class={cx('btn', !next && 'primary')} onClick={() => go('learn/' + firstFoundation.id)}>{next ? 'Open foundations' : d.stat(firstFoundation.id).got === d.stat(firstFoundation.id).total ? 'Review foundations' : 'Start with ' + firstFoundation.name}<Icon.chev size={18} /></button>
          <details class="reveal-list">
            <summary>Browse all {foundations.length} foundation topics</summary>
            <ol class="foundation-path">{foundations.map((t, i) => <li><button onClick={() => go('learn/' + t.id)}><span class="foundation-node">{i + 1}</span><b>{t.name}</b><Icon.chev size={18} /></button></li>)}</ol>
          </details>
        </section>}
        {d.loading ? <Loading error={d.topics.error} retry={d.topics.reload} /> : groups.map(([sc, ts]) => (
          <section class="subj" aria-label={SCOPE_LABEL[sc]}>
            <h2 class="subj-h"><i /> {SCOPE_LABEL[sc]}</h2>
            <ul class={'list card u-' + sc}>
              {ts.map((t) => {
                const s = d.stat(t.id), n = (d.kids.get(t.id) ?? []).length
                return (
                  <li><button class="lrow col" onClick={() => go('learn/' + t.id)}>
                    <span class="row between gap"><b>{t.name}{s.total > 0 && s.got >= s.total && <span class="crown inl" role="img" aria-label="All concepts learned"><Icon.crown size={18} /></span>}</b><small>{s.got} of {s.total} learned</small></span>
                    <Bar pct={s.total ? s.got / s.total : 0} label={`${t.name} concepts learned`} />
                    <span class="row gap wrap"><small>{n} chapter{n === 1 ? '' : 's'}</small><WChip w={w} id={t.id} root /></span>
                  </button></li>
                )
              })}
            </ul>
          </section>
        ))}
        <div class="more-links">
          <button class="btn sm" onClick={() => go('learn/notes')}>My notes</button>
          <button class="btn sm" onClick={() => go('learn/bookmarks')}>Saved questions</button>
          {w.ready && <SortToggle />}
        </div>
        <WFootnote w={w} />
      </main>
    </>
  )
}
const SCOPE_LABEL: Record<string, string> = { shared: 'Common to both papers', cs: 'Computer Science', da: 'Data Science and AI', ga: 'General Aptitude' }

function TopicLearn({ id }: { id: string }) {
  const d = useLearnData()
  const w = useWeight(); const { sortW } = usePrefs()
  const t = d.topics.data?.find((x) => x.id === id)
  const chapters = sortW ? [...(d.kids.get(id) ?? [])].sort((a, b) => w.score(b.id, false) - w.score(a.id, false)) : (d.kids.get(id) ?? [])
  if (d.loading) return <><Header title="Learn" onBack={() => go('learn')} /><main class="page"><Loading error={d.topics.error} retry={d.topics.reload} /></main></>
  if (!t) return <><Header title="Not found" onBack={() => go('learn')} /><main class="page"><Empty art="empty" title="Topic not found" /></main></>
  if (chapters.length) {
    if (id === 'found') {
      const available = d.concepts.data ? chapters.filter((c) => d.concepts.data!.items.some((atom) => atom.topic_id === c.id)) : chapters
      return <><Header title="Foundations" onBack={() => go('learn')} sub="Build the basics in short chapters." /><main class="page"><ol class="foundation-path">{available.map((c, i) => <li><button onClick={() => go('learn/' + c.id)}><span class="foundation-node">{i + 1}</span><b>{c.name}</b><Icon.chev size={18} /></button></li>)}</ol></main></>
    }
    const nx = d.nextIn(id), s = d.stat(id)
    const nxChapter = nx && chapters.find((c) => subtreeIds(d.kids, c.id).has(nx.topic_id))
    return (
      <>
        <Header title={t.name} onBack={() => go('learn')} sub="Pick a chapter to read." />
        <main class={'page u-' + t.scope}>
          {nx && nxChapter
            ? <ContinueCard eyebrow="Up next" title={nx.name} line={nxChapter.name} cta="Continue" onGo={() => go(`learn/${nx.topic_id}/${nx.atom_id}`)} pct={s.total ? s.got / s.total : 0} progress={`${s.got} of ${s.total} learned`} />
            : <ContinueCard eyebrow="Subject complete" title={`You have learned every ${t.name} concept`} cta={`Practise ${t.name}`} onGo={() => go('practice/' + id)} />}
          <ul class="list card">
            {chapters.map((c) => { const cs = d.stat(c.id); return (
              <li><button class="lrow col" onClick={() => go('learn/' + c.id)}>
                <span class="row between gap"><b>{c.name}</b><small>{cs.got} of {cs.total} learned</small></span>
                <Bar pct={cs.total ? cs.got / cs.total : 0} label={`${c.name} concepts learned`} />
                <span><WChip w={w} id={c.id} root={false} /></span>
              </button></li>
            ) })}
          </ul>
          <div class="more-links">
            <button class="btn sm" onClick={() => go('learn/course/' + id)}>Video course</button>
            <button class="btn sm" onClick={() => go('practice/' + id)}>Practise {t.name}</button>
            {w.ready && <SortToggle />}
          </div>
          <WFootnote w={w} />
        </main>
      </>
    )
  }
  return <ChapterPage topic={t} parent={d.topics.data?.find((x) => x.id === t.parent_id)} concepts={(d.concepts.data?.items ?? []).filter((c) => c.topic_id === id)} prog={d.prog.data} />
}

type CTab = 'concepts' | 'notes' | 'videos'
const CTABS: [CTab, string][] = [['concepts', 'Concepts'], ['notes', 'Notes'], ['videos', 'Videos']]

function ChapterPage({ topic, parent, concepts, prog }: { topic: Topic; parent?: Topic; concepts: { topic_id: string; atom_id: string; name: string; one_line: string; has_card: boolean }[]; prog?: Map<string, string> }) {
  const id = topic.id
  const modules = useModules()
  const mastery = useLoad(() => getMastery().catch(() => null), [])
  const prereqs = useLoad(() => getPrereqs(id).catch(() => null), [id])
  const readiness = useLoad(() => getReadiness(id).catch(() => null), [id])
  const [tab, setTab] = useState<CTab>('concepts')
  const done = (c: { topic_id: string; atom_id: string }) => prog?.get(c.topic_id + '/' + c.atom_id) === 'got_it'
  const got = concepts.filter(done).length
  const next = concepts.find((c) => !done(c))
  const practiceOn = modules.some((m) => m.id === 'practice' && m.enabled)
  const checkPrimary = !!readiness.data?.available && readiness.data.latest?.correct !== readiness.data.latest?.total
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const k = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1
    if (k < 0) return
    e.preventDefault(); const j = (k + CTABS.length) % CTABS.length; setTab(CTABS[j][0]); tabRefs.current[j]?.focus()
  }
  return (
    <>
      <Header title={topic.name} onBack={() => go(parent ? 'learn/' + parent.id : 'learn')} sub="Read each concept, then try a question." />
      <main class={'page u-' + topic.scope}>
        {topic.scope !== 'foundation' && !!(prereqs.data?.foundations.length || prereqs.data?.chapters.length) && <section class="card before-start">
          <h2>Before you start</h2><p class="muted">Check the basics you will use here.</p>
          <div class="prereq-chips">{[...(prereqs.data?.foundations ?? []), ...(prereqs.data?.chapters ?? [])].map(p => { const checked = readiness.data?.latest?.prerequisites.find(x => x.id === p.id); const ready = checked ? checked.ready : p.ready; return <button class={cx('prereq-chip', ready && 'ready')} onClick={() => go('learn/' + p.id)}>{ready ? '✓' : '○'} {p.name} · {ready ? 'ready' : 'needs work'}</button> })}</div>
          {readiness.data?.available && <button class={cx('btn block', checkPrimary && 'primary')} onClick={() => go('learn/readiness/' + id)}>Readiness check (2 min)</button>}
          {!readiness.data?.available && <small class="muted">Readiness check coming soon.</small>}
        </section>}
        {topic.scope === 'foundation' && concepts.length === 0 && <section class="card"><h2>Coming soon</h2><p class="muted">The explainer and practice path for this foundation are being prepared.</p></section>}
        {concepts.length > 0 && (next
          ? <ContinueCard eyebrow={got ? 'Up next' : 'Start here'} title={next.name} line={next.one_line} cta={got ? 'Continue' : 'Start'} onGo={() => go(`learn/${id}/${next.atom_id}`)} pct={got / concepts.length} progress={`${got} of ${concepts.length} learned`} primary={!checkPrimary} />
          : <ContinueCard eyebrow="Chapter complete" title="You have learned every concept here" cta={practiceOn ? 'Practise this chapter' : 'Review concepts'} onGo={() => practiceOn ? go('practice/' + id) : setTab('concepts')} pct={1} progress={`${got} of ${concepts.length} learned`} primary={!checkPrimary} />)}
        <div class="tabs-seg" role="tablist" aria-label="Chapter sections">
          {CTABS.map(([k, l], i) => <button ref={(el) => { tabRefs.current[i] = el }} role="tab" id={`ct-${k}`} aria-selected={tab === k} aria-controls={`cp-${k}`} tabIndex={tab === k ? 0 : -1} class={cx(tab === k && 'on')} onKeyDown={(e) => onKey(e, i)} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <div role="tabpanel" id={`cp-${tab}`} aria-labelledby={`ct-${tab}`} class="tabpanel">
          {tab === 'concepts' && (concepts.length === 0 ? topic.scope === 'foundation' ? null : <Empty art="empty" title="No concepts yet">This chapter has no concept notes yet. Practise it directly.</Empty> : (
            <>
              <ul class="list card">
                {concepts.map((c, i) => { const ok = done(c); const sc = mastery.data?.items?.find((x: any) => x.topic_id === id && x.atom_id === c.atom_id)?.score ?? 0; return (
                  <li><button class="lrow col" onClick={() => go(`learn/${id}/${c.atom_id}`)}>
                    <span class="row gap"><span class={cx('mark', ok ? 'ok' : 'none')} aria-label={ok ? 'Learned' : 'Not learned yet'}>{ok ? '✓' : i + 1}</span><b class="grow">{c.name}</b>{sc > 0 && <small>{sc}% mastered</small>}<Icon.chev size={18} /></span>
                    <small class="concept-line"><Md text={c.one_line} /></small>
                  </button></li>
                ) })}
              </ul>
              {practiceOn && <button class="btn block" onClick={() => go('practice/' + id)}>Practise this chapter</button>}
            </>
          ))}
          {tab === 'notes' && <NotesTab topic={topic} />}
          {tab === 'videos' && <VideoCatalog topic={id} />}
        </div>
      </main>
    </>
  )
}

function ReadinessPage({ chapter }: { chapter: string }) {
  const check = useLoad(() => getReadiness(chapter), [chapter])
  const prereqs = useLoad(() => getPrereqs(chapter), [chapter])
  const concepts = useLoad(() => getConcepts().catch(() => ({ items: [], chapters: [] })), [])
  const progress = useLoad(() => getConceptProgress().catch(() => new Map<string, string>()), [])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ReadinessResult | null>(null)
  const [busy, setBusy] = useState(false)
  const names = new Map([...(prereqs.data?.foundations ?? []), ...(prereqs.data?.chapters ?? [])].map(p => [p.id, p.name]))
  const openPrereq = (id: string) => {
    const first = concepts.data?.items.find(c => c.topic_id === id && progress.data?.get(`${id}/${c.atom_id}`) !== 'got_it')
    go(first ? `learn/${id}/${first.atom_id}` : `learn/${id}`)
  }
  const submit = async () => {
    setBusy(true)
    try { const r = await submitReadiness(chapter, answers); if (isQueued(r)) toast('Check queued. Reopen when online for results.'); else setResult(r) }
    catch (e: any) { toast(e.message || 'Could not check answers') }
    setBusy(false)
  }
  return <><Header title="Readiness check" onBack={() => go('learn/' + chapter)} sub="A few quick questions on the basics." /><main class="page readiness-page">
    {check.loading ? <Loading error={check.error} retry={check.reload} /> : !check.data?.available ? <Empty art="empty" title="Coming soon">This chapter’s readiness check is being prepared.</Empty> : result ? <>
      <section class="card"><h2>{result.correct} of {result.total} correct</h2><p class="muted">Here is what to do before the chapter.</p></section>
      {result.prerequisites.some(p => !p.ready) && <section><h2>Do these first</h2><ul class="list card">{result.prerequisites.filter(p => !p.ready).map(p => <li><button class="lrow" onClick={() => openPrereq(p.id)}>{names.get(p.id) ?? p.id}<Icon.chev size={18} /></button></li>)}</ul></section>}
      <ul class="list card">{result.questions.map(q => <li class="readiness-feedback"><b>{q.correct ? '✓' : '○'} {names.get(q.tests) ?? q.tests}</b><small>{q.explain}</small></li>)}</ul>
      <button class="btn primary block" onClick={() => go('learn/' + chapter)}>{result.correct === result.total ? 'Start chapter' : 'Skip, I’m ready'}</button>
    </> : <>
      {check.data.questions.map((q, i) => <fieldset class="card readiness-question"><legend>{i + 1}. <Md text={q.stem} /></legend>
        {q.type === 'MCQ' ? q.options?.map((option, k) => { const key = typeof option === 'string' ? String.fromCharCode(65 + k) : option.key; return <label class="readiness-option"><input type="radio" name={q.id} checked={answers[q.id] === key} onChange={() => setAnswers({ ...answers, [q.id]: key })} /><span>{key}. <Md text={typeof option === 'string' ? option : option.text} /></span></label> }) : <input aria-label={`Answer to question ${i + 1}`} type="number" inputMode="decimal" value={answers[q.id] ?? ''} onInput={e => setAnswers({ ...answers, [q.id]: (e.target as HTMLInputElement).value })} />}
      </fieldset>)}
      <button class="btn primary block" disabled={busy || check.data.questions.some(q => !String(answers[q.id] ?? '').trim())} onClick={submit}>{busy ? 'Checking…' : 'Check answers'}</button>
      <button class="btn block" onClick={() => go('learn/' + chapter)}>Skip, I’m ready</button>
    </>}
  </main></>
}

/** "Explain simply" switch, remembered on this device (store.ts keeps it in localStorage with try/catch). */
export function SimpleToggle() {
  const { simple } = usePrefs()
  return <label class="toggle compact simple-tg"><span>Explain simply</span><input type="checkbox" checked={simple} onChange={() => setPrefs({ simple: !simple })} /><i /></label>
}

function NotesTab({ topic }: { topic: Topic }) {
  const id = topic.id
  const bp = useLoad(() => getBlueprint(id).catch(() => null), [id])
  const ex = useLoad(() => getExplainer(id).catch(() => null), [id])
  const cards = useLoad(() => getCards(id).catch(() => []), [id])
  const w = useWeight()
  const { simple } = usePrefs()
  const [peek, setPeek] = useState(false)
  const note = (ex.data as ExplainerFile | null | undefined)?.chapter_note
  const formulas = (cards.data ?? []).filter((c) => (c.tags ?? []).includes('formula'))
  const showSimple = !!note?.simple && (simple || peek)
  return (
    <div class="notes-tab">
      {note?.simple && <SimpleToggle />}
      {note ? (
        <>
          {showSimple && <aside class="cr-simple"><h3>In simple words</h3><Md text={note.simple} /></aside>}
          <section class="plain"><h2>What this chapter is about</h2><Md text={note.about} />
            {note.simple && !simple && <button type="button" class="cr-link" aria-expanded={peek} onClick={() => setPeek(!peek)}>{peek ? 'Hide simpler version' : 'Simpler'}</button>}
          </section>
          {note.concept_map && note.concept_map.length > 0 && (
            <section class="plain"><h2>Concepts, in the order to learn them</h2>
              <ol class="cmap">{note.concept_map.map((c) => <li><button type="button" onClick={() => go(`learn/${id}/${c.atom_id}`)}><b><Md text={c.title} /></b>{c.one_line && <small><Md text={c.one_line} /></small>}</button></li>)}</ol>
            </section>
          )}
          {note.gate_patterns && note.gate_patterns.length > 0 && (
            <section class="plain"><h2>How GATE tests it</h2>
              <ul class="cr-list">{note.gate_patterns.map((p) => <li><Md text={p} /></li>)}</ul>
              <WChip w={w} id={id} root={false} />
            </section>
          )}
        </>
      ) : bp.data?.summary_md ? <section class="plain"><h2>Chapter note</h2><Layered focus={bp.data.summary_md} full={bp.data.summary_full_md} class="concept" /></section> : null}
      {formulas.length > 0 && (
        <section class="plain" aria-label="Formula sheet"><h2>Formula sheet</h2>
          <dl class="formulas">{formulas.map((c) => <div><dt><Md text={c.front} /></dt><dd><Md text={c.back} /></dd></div>)}</dl>
        </section>
      )}
      <NoteEditor topic={id} />
      <div class="more-links"><DoubtButton refType="chapter" refId={id} /><button class="btn sm" onClick={() => go(`learn/sheet/${topic.subject_id}`)}>Print revision sheet</button></div>
    </div>
  )
}

function NoteEditor({ topic }: { topic: string }) {
  const n = useLoad(() => getNote(topic).catch(() => ''), [topic])
  const [v, setV] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const val = v ?? n.data ?? ''
  const save = async () => { setBusy(true); try { const r = await putNote(topic, val); toast(isQueued(r) ? 'Note saved offline' : 'Note saved') } catch (e: any) { toast(e.message || 'Could not save note') } setBusy(false) }
  return (
    <section class="plain" aria-label="My notes">
      <h2>My notes</h2>
      <label class="sr" for={'note-' + topic}>My notes for this chapter</label>
      <textarea id={'note-' + topic} rows={4} value={val} placeholder="Tricks, mistakes to avoid, formulas you keep forgetting. Supports $math$." onInput={(e) => setV((e.target as HTMLTextAreaElement).value)} />
      {val.trim() && <div class="note-preview"><small class="muted">Preview</small><Md text={val} /></div>}
      <button class="btn sm block note-save" disabled={busy || v === null || v === (n.data ?? '')} onClick={save}>{busy ? 'Saving...' : 'Save note'}</button>
    </section>
  )
}

/** Concept reader: full screen, one concept at a time. Focus = idea, animation, first example, check yourself. "Go deeper" opens the rest. */
function ConceptPage({ topic, atom }: { topic: string; atom: string }) {
  useActiveStudy(topic)
  const topics = useLoad(getTopics, [])
  useEffect(() => {
    if (topics.data) {
      const parents = new Map(topics.data.map((t) => [t.id, t.parent_id]))
      setTopicParents((id) => parents.get(id))
    }
  }, [topics.data])
  const bp = useLoad(() => getBlueprint(topic).catch(() => null), [topic])
  const ex = useLoad(() => getExplainer(topic).catch(() => null), [topic])
  const prog = useLoad(getConceptProgress, [])
  const bank = useLoad(() => getBank().catch(() => []), [])
  const mastery = useLoad(() => getMastery().catch(() => null), [])
  const prereqs = useLoad(() => getPrereqs(topic).catch(() => null), [topic])
  const concepts = useLoad(() => getConcepts().catch(() => ({ items: [], chapters: [] })), [])
  const [refresher, setRefresher] = useState(false)
  const modules = useModules()
  const dots = useRef<HTMLDivElement>(null)
  const t = topics.data?.find((x) => x.id === topic)
  const atoms = bp.data?.atoms ?? []
  const idx = atoms.findIndex((a) => a.id === atom)
  const c = idx >= 0 ? atoms[idx] : undefined
  const status = prog.data?.get(topic + '/' + atom)
  const file = ex.data as ExplainerFile | null | undefined
  const card = file?.cards.find((k) => k.atom_id === atom)
  const scenes: Record<string, Scene> = Object.fromEntries((file?.scenes ?? []).map((s) => [s.id, s]))
  const anySimple = !!file?.cards.some((k) => k.simple)
  const qs = (bank.data ?? []).filter((q) => q.topic_id === topic && q.atoms?.includes(atom) && q.source !== 'official').sort(byEase)
  const practiceOn = modules.some((m) => m.id === 'practice' && m.enabled)
  const score = mastery.data?.items?.find((x: any) => x.topic_id === topic && x.atom_id === atom)?.score ?? 0
  const prev = idx > 0 ? atoms[idx - 1] : undefined, next = idx >= 0 && idx < atoms.length - 1 ? atoms[idx + 1] : undefined
  const open = (a?: { id: string }) => { if (a) { go(`learn/${topic}/${a.id}`, true); scrollTo(0, 0) } }
  const isDone = (a: { id: string }) => prog.data?.get(topic + '/' + a.id) === 'got_it'
  useEffect(() => { dots.current?.querySelector('[aria-current=step]')?.scrollIntoView({ inline: 'center', block: 'nearest' }) }, [atom, atoms.length])
  const toggle = async () => {
    const nextStatus = status === 'got_it' ? null : 'got_it'
    prog.set((m) => { const n = new Map(m ?? []); if (nextStatus) n.set(topic + '/' + atom, 'got_it'); else n.delete(topic + '/' + atom); return n })
    try { const r = await setConcept(topic, atom, nextStatus); if (isQueued(r)) toast('Saved offline') } catch (e: any) { toast(e.message || 'Could not save'); prog.reload(); return }
    if (nextStatus) { if (next) open(next); else toast('That was the last concept in this chapter') }
  }
  const back = `learn/${topic}/${atom}`
  const tryQ = () => {
    const ids = qs.filter((q) => (q.level ?? 3) <= 2).concat(qs.filter((q) => (q.level ?? 3) > 2)).slice(0, 5).map((q) => q.id)
    if (!ids.length) return go(`practice/${topic}?atom=${atom}`)
    startSession(ids, `${c?.name ?? 'Concept'}: try it`, back); go('q/' + ids[0])
  }
  void qLabel
  const sw = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: TouchEvent) => { sw.current = (e.target as Element).closest('.anim, .katex-display, table, pre, textarea') ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchEnd = (e: TouchEvent) => {
    const s = sw.current; sw.current = null; if (!s) return
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) open(dx < 0 ? next : prev)
  }
  const loading = bp.loading || ex.loading
  const title = card?.title ?? c?.name ?? 'Concept'
  const foundations = prereqs.data?.foundations ?? []
  const hint = `${title} ${c?.one_line ?? ''}`.toLowerCase()
  const preferred = /derivat|differentiab|slope|l.h[oô]pital/.test(hint) ? 'found.derivatives'
    : /sin|cos|tan|trig/.test(hint) ? 'found.trig'
    : /log|exponent|growth|e\^/.test(hint) ? 'found.explog'
    : /series|sum|taylor/.test(hint) ? 'found.series'
    : /matrix|vector/.test(hint) ? 'found.vectors_matrices'
    : /limit|continu/.test(hint) ? 'found.limits_intuition'
    : /factor|fraction|equation/.test(hint) ? 'found.algebra' : ''
  const foundation = foundations.find(p => p.id === preferred) ?? foundations[0]
  const foundationConcepts = (concepts.data?.items ?? []).filter(x => x.topic_id === foundation?.id)
  return (
    <div class={'reader u-' + (t?.scope ?? 'shared')}>
      <div class="rbar">
        <button class="icon-btn" aria-label="Close and go back to the chapter" onClick={() => navBack('learn/' + topic)}><Icon.close /></button>
        <button class="icon-btn" aria-label="Previous concept" disabled={!prev} onClick={() => open(prev)}><Icon.back /></button>
        <div class="rdots" ref={dots} role="group" aria-label="Concepts in this chapter">
          {atoms.map((a, k) => <button class={cx('rdot', isDone(a) && 'done', a.id === atom && 'cur')} aria-current={a.id === atom ? 'step' : undefined} aria-label={`${a.name}. Concept ${k + 1} of ${atoms.length}${isDone(a) ? ', learned' : ''}`} onClick={() => open(a)}><i /></button>)}
        </div>
        <button class="icon-btn flip" aria-label="Next concept" disabled={!next} onClick={() => open(next)}><Icon.back /></button>
      </div>
      <main class="page reader-page" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {loading ? <Loading /> : (
          <>
            <div class="r-top">
              <small>{idx >= 0 ? `Concept ${idx + 1} of ${atoms.length}` : 'Concept'}{t ? ` · ${t.name}` : ''}</small>
              {anySimple && <SimpleToggle />}
            </div>
            <h1 class="r-title"><Md text={title} /></h1>
            {foundation && <button class="cr-link" onClick={() => setRefresher(true)}>Need a refresher?</button>}
            {card && <CopySearch text={[title, card.simple, card.idea ?? card.what, card.definition].filter(Boolean).join('\n\n')} query={`${title} ${t?.name ?? ''}`} kind="concept" />}
            {card
              ? <ConceptBody key={atom} uid={'cr-' + atom} card={card} scenes={scenes} onTry={(tr) => { if (tr.id) { setQueue([tr.id]); go('q/' + tr.id) } else toast(tr.label) }}
                  extras={<div class="cr-extras">
                    <ConceptVideos topic={topic} atom={atom} />
                    {score > 0 && <p class="muted">Your mastery of this concept: {score}%.</p>}
                    <div class="more-links">{practiceOn && <button class="btn sm" onClick={() => go(`practice/${topic}?atom=${atom}`)}>Practise this concept</button>}<DoubtButton refType="concept" refId={`${topic}/${atom}`} /></div>
                  </div>} />
              : <Empty art="cards" title="No explainer for this concept yet">{c?.one_line ? <Md text={c.one_line} /> : 'Try a question to test yourself.'}</Empty>}
          </>
        )}
      </main>
      {refresher && foundation && <Sheet title={foundation.name} onClose={() => setRefresher(false)}>
        <p class="muted">Review the basics for this concept.</p>
        {foundationConcepts.length ? <ul class="list">{foundationConcepts.map(x => <li><button class="lrow" onClick={() => { setRefresher(false); go(`learn/${foundation.id}/${x.atom_id}`) }}>{x.name}<Icon.chev size={18} /></button></li>)}</ul> : <p>Concepts coming soon.</p>}
        <button class="btn block" onClick={() => { setRefresher(false); go('learn/' + foundation.id) }}>Open foundation chapter</button>
      </Sheet>}
      <div class="actionbar reader-bar">
        <button class={cx('btn grow', status === 'got_it' ? 'ok' : 'primary')} aria-pressed={status === 'got_it'} onClick={toggle}>{status === 'got_it' ? <><Icon.check size={20} /> Got it</> : 'Got it'}</button>
        {practiceOn && <button class="btn grow" onClick={tryQ}>Try a question</button>}
      </div>
    </div>
  )
}

function Bookmarks() {
  const bm = useLoad(getBookmarks, [])
  const bank = useLoad(() => getBank().catch(() => []), [])
  const list = (bank.data ?? []).filter((q) => bm.data?.has(q.id))
  const open = (id: string) => { setQueue(list.map((q) => q.id)); go('q/' + id) }
  return (
    <>
      <Header title="Bookmarks" onBack={() => go('learn')} />
      <main class="page">
        {bm.loading || bank.loading ? <Loading /> : list.length === 0 ? <Empty art="empty" title="No bookmarks yet">Tap the star on any question to save it here.</Empty> : (
          <ul class="qlist card">{list.map((q) => <li><button class="qrow" onClick={() => open(q.id)}><span class="qt">{q.source === 'official' ? qLabel(q) : <Md text={q.stem}/>}</span><span class="qm"><small>{q.type} {q.marks}m</small></span><Icon.chev size={18} /></button></li>)}</ul>
        )}
      </main>
    </>
  )
}

import { getNotes } from '../../api'
function NotesList() {
  const notes = useLoad(getNotes, [])
  const topics = useLoad(getTopics, [])
  return (
    <>
      <Header title="My notes" onBack={() => go('learn')} />
      <main class="page">
        {notes.loading ? <Loading /> : (notes.data ?? []).length === 0 ? <Empty art="empty" title="No notes yet">Open a chapter and write one under My notes.</Empty> : (
          <ul class="list card">{notes.data!.map((n) => <li><button class="lrow col" onClick={() => go('learn/' + n.topic_id)}><b>{topics.data?.find((t) => t.id === n.topic_id)?.name ?? n.topic_id}</b><small class="concept-line note-excerpt"><Md text={n.body} /></small></button></li>)}</ul>
        )}
      </main>
    </>
  )
}

function RevisionSheet({subject}:{subject:string}) {
  const topics=useLoad(getTopics,[]), cards=useLoad(()=>getCards().catch(()=>[]),[]), mistakes=useLoad(()=>getMistakes(false,'all').catch(()=>[]),[]), mastery=useLoad(getMastery,[])
  const chapters=(topics.data??[]).filter(t=>t.subject_id===subject && t.parent_id)
  const formulas=(cards.data??[]).filter(c=>c.topic_id&&chapters.some(t=>t.id===c.topic_id)&&(c.tags??[]).includes('formula')).slice(0,8)
  const traps=(mistakes.data??[]).map(m=>m.question).filter((q):q is NonNullable<typeof q>=>!!q&&chapters.some(t=>t.id===q.topic_id)&&!!q.trap_note).slice(0,5)
  const missed=(mastery.data?.items??[]).filter((x:any)=>x.subject_id===subject&&x.attempts>0).sort((a:any,b:any)=>a.score-b.score).slice(0,5)
  return <><Header title="Revision sheet" onBack={()=>go('learn/'+subject)}/><main class="page revision-sheet"><div class="row between"><h2>{topics.data?.find(t=>t.id===subject)?.name??subject}</h2><button class="btn no-print" onClick={()=>print()}>Print / Save as PDF</button></div>
    <section><h3>Formula flashcards</h3>{formulas.length?formulas.map(c=><div class="sheet-row"><Md text={c.front}/><Md text={c.back}/></div>):<p>No formula cards yet.</p>}</section>
    <section><h3>Top traps</h3>{traps.length?traps.map(q=><div class="sheet-row"><Md text={q.trap_note}/></div>):<p>No traps recorded yet.</p>}</section>
    <section><h3>Most missed concepts</h3>{missed.length?missed.map((x:any)=><div class="sheet-row">{x.atom_name} · {x.score}% mastery</div>):<p>Attempt questions to see missed concepts.</p>}</section>
  </main></>
}
