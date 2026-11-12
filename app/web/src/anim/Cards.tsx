import { useState } from 'preact/hooks'
import { Md } from '../md'
import { usePrefs } from '../store'
import { AnimPlayer } from './Player'
import type { Card, Check, Example, ExplainerFile, Scene } from './types'
import './anim.css'

export type Mode = 'focus' | 'full'
export type TryRef = { id?: string; label: string }

const LEVEL_NAME: Record<string, string> = { basic: 'Basic', gate: 'GATE style', twist: 'A twist to watch for' }

/** One normalised view of a card: v2 fields win, v1 fields (what/why/how/trap) fill the gaps. */
export function normCard(c: Card) {
  const v2 = !!c.idea
  const asEx = (e: Example | string): Example => (typeof e === 'string' ? { setup: e, steps: [] } : e)
  const examples = (c.examples?.length ? c.examples : c.example ? [c.example] : []).map(asEx)
  const checks: Check[] = Array.isArray(c.check) ? c.check : c.check ? [c.check] : []
  return {
    idea: c.idea ?? c.what, ideaFull: v2 ? c.idea_full : c.what_full, simple: c.simple?.trim() || undefined,
    definition: c.definition, intuition: c.intuition_full, examples, checks,
    why: c.why, whyFull: c.why_full, how: c.how, howFull: c.how_full, mistake: c.mistake ?? c.trap, mistakeFull: c.mistake ? undefined : c.trap_full,
    edge: c.edge_cases ?? [], links: c.connections ?? [], asked: c.asked,
    tryRef: (typeof c.try === 'string' ? { label: c.try } : c.try) as TryRef | undefined,
  }
}

function Sec({ label, children, tone }: { label: string; children: any; tone?: string }) {
  return <section class={'cr-sec' + (tone ? ' ' + tone : '')}><h3>{label}</h3>{children}</section>
}

/** "Check yourself": the question is visible, the answer opens on tap. */
export function CheckList({ items, uid, start = 0 }: { items: Check[]; uid: string; start?: number }) {
  const [open, setOpen] = useState<Record<number, boolean>>({})
  return <div class="cr-checks">{items.map((c, i) => {
    const id = `${uid}-chk-${start + i}`, on = !!open[i]
    return <div class="cr-check" key={i}>
      <div class="cr-q"><Md text={c.q} /></div>
      <button type="button" class="btn sm" aria-expanded={on} aria-controls={id} onClick={() => setOpen({ ...open, [i]: !on })}>{on ? 'Hide answer' : 'Show answer'}</button>
      {on && <div class="cr-a" id={id}><Md text={c.a} /></div>}
    </div>
  })}</div>
}

/** Worked example: setup, numbered steps, answer. When the animation has the same number of steps, tapping a step moves the animation and the animation highlights the step. */
function ExampleView({ ex, scene, step, setStep }: { ex: Example; scene?: Scene; step?: number; setStep?: (n: number) => void }) {
  const steps = ex.steps ?? []
  const sync = !!scene && setStep !== undefined && steps.length > 0 && scene.steps.length === steps.length
  return <div class="cr-ex">
    {ex.setup && <div class="cr-setup"><Md text={ex.setup} /></div>}
    {steps.length > 0 && <ol class={'cr-steps' + (sync ? ' sync' : '')}>{steps.map((s, i) => {
      const cur = sync && step === i
      return <li key={i} class={cur ? 'on' : ''} aria-current={cur ? 'step' : undefined}>
        {sync ? <button type="button" aria-label={`Show step ${i + 1} in the animation`} onClick={() => setStep!(i)}><Md text={s} /></button> : <Md text={s} />}
      </li>
    })}</ol>}
    {ex.answer && <div class="cr-ans"><b>Answer</b><Md text={ex.answer} /></div>}
  </div>
}

/** The body of one concept. Focus: idea, animation, first example, check yourself. "Go deeper" opens the rest in spec order. */
export function ConceptBody({ card, scenes, uid, deeper = false, onTry, extras }: {
  card: Card; scenes: Record<string, Scene>; uid: string; deeper?: boolean; onTry?: (t: TryRef, c: Card) => void; extras?: any
}) {
  const { simple: simpleOn } = usePrefs()
  const [open, setOpen] = useState(deeper)
  const [peek, setPeek] = useState(false)
  const [step, setStep] = useState(0)
  const n = normCard(card)
  const scene = card.scene ? scenes[card.scene] : undefined
  const idea = open && n.ideaFull ? n.ideaFull : n.idea
  const rest = n.examples.slice(1)
  const how = open && n.howFull?.length ? n.howFull : n.how
  const why = open && n.whyFull ? n.whyFull : n.why
  const mistake = open && n.mistakeFull ? n.mistakeFull : n.mistake
  const hasDeeper = !!(n.definition || n.intuition || rest.length || why || how?.length || mistake || n.edge.length || n.links.length || n.checks.length > 1 || n.asked || n.tryRef || n.ideaFull || extras)
  const bodyId = `${uid}-deeper`
  const showSimple = !!n.simple && (simpleOn || peek)
  return <article class="cr" aria-label={card.title}>
    {showSimple && <aside class="cr-simple"><h3>In simple words</h3><Md text={n.simple} /></aside>}
    {idea && <section class="cr-idea"><h3>The big idea</h3><Md text={idea} />
      {n.simple && !simpleOn && <button type="button" class="cr-link" aria-expanded={peek} onClick={() => setPeek(!peek)}>{peek ? 'Hide simpler version' : 'Simpler'}</button>}
    </section>}
    {card.scene && <section class="cr-scene" aria-label="Animation">
      {scene ? <AnimPlayer scene={scene} step={step} onStep={setStep} /> : <p class="xc-miss">Animation "{card.scene}" is not in this file.</p>}
    </section>}
    {n.examples[0] && <Sec label={n.examples.length > 1 ? 'Example 1' : 'Worked example'}><ExampleView ex={n.examples[0]} scene={scene} step={step} setStep={setStep} /></Sec>}
    {n.checks[0] && <Sec label="Check yourself"><CheckList items={[n.checks[0]]} uid={uid} /></Sec>}
    {hasDeeper && <button type="button" class="btn block cr-more" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Go deeper'}</button>}
    {open && <div id={bodyId} class="cr-deeper">
      {n.definition && <Sec label="The exact rule"><Md text={n.definition} /></Sec>}
      {n.intuition && <Sec label="Why it works"><Md text={n.intuition} /></Sec>}
      {rest.map((e, i) => <Sec label={`Example ${i + 2} · ${LEVEL_NAME[e.level ?? ''] ?? 'More practice'}`}><ExampleView ex={e} /></Sec>)}
      {why && <Sec label="Why it matters"><Md text={why} /></Sec>}
      {how && how.length > 0 && <Sec label="How to solve it in the exam"><ol class="xc-how">{how.map((h, i) => <li key={i}><Md text={h} /></li>)}</ol></Sec>}
      {mistake && <Sec label="Common mistake" tone="warn"><Md text={mistake} /></Sec>}
      {n.edge.length > 0 && <Sec label="Special cases"><ul class="cr-list">{n.edge.map((e, i) => <li key={i}><Md text={e} /></li>)}</ul></Sec>}
      {n.links.length > 0 && <Sec label="Connected ideas"><ul class="cr-list">{n.links.map((e, i) => <li key={i}><Md text={e} /></li>)}</ul></Sec>}
      {n.checks.length > 1 && <Sec label="More checks"><CheckList items={n.checks.slice(1)} uid={uid} start={1} /></Sec>}
      {n.asked && <p class="cr-asked"><Md text={n.asked.replace(/^asked:?\s*/i, 'Asked in GATE: ')} /></p>}
      {n.tryRef && <Sec label="Try it">{onTry ? <button type="button" class="xc-try" onClick={() => onTry(n.tryRef!, card)}><Md text={n.tryRef.label} /></button> : <Md text={n.tryRef.label} />}</Sec>}
      {extras}
    </div>}
  </article>
}

/** Every card in a file, stacked (used by the animation gallery). `mode="full"` opens "Go deeper" on each. */
export function ExplainerCards({ file, scenes, mode = 'focus', onTry, paged = false, class: klass = '' }: {
  file: ExplainerFile; scenes?: Record<string, Scene>; mode?: Mode; onTry?: (t: TryRef, card: Card) => void; paged?: boolean; class?: string
}) {
  const [cur, setCur] = useState(0)
  const [all, setAll] = useState(false)
  const map: Record<string, Scene> = { ...Object.fromEntries((file.scenes ?? []).map((s) => [s.id, s])), ...scenes }
  const n = file.cards.length
  const one = paged && !all && n > 1
  const i = Math.min(cur, n - 1)
  const view = (c: Card, k: number) => <div class="xc" key={c.atom_id ?? k}>{c.title && <h3 class="xc-title"><Md text={c.title} /></h3>}<ConceptBody card={c} scenes={map} uid={`xc${k}`} deeper={mode === 'full'} onTry={onTry} /></div>
  return <div class={'anim-cards ' + klass}>
    {one ? view(file.cards[i], i) : file.cards.map(view)}
    {one && <nav class="xc-nav" aria-label="Explainer cards">
      <button type="button" class="btn sm" disabled={i === 0} onClick={() => setCur(i - 1)}>Previous</button>
      <span class="xc-pos" aria-live="polite">Card {i + 1} of {n}</span>
      <button type="button" class="btn sm" disabled={i === n - 1} onClick={() => setCur(i + 1)}>Next</button>
    </nav>}
    {paged && n > 1 && <button type="button" class="btn sm link xc-all" onClick={() => setAll(!all)}>{all ? 'Show one card at a time' : `Show all ${n} cards`}</button>}
  </div>
}
