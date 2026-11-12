import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { loadKatex, Md } from '../md'
import { byId, easeOut, mixFrame, stateAt, targetFrame, type Frame, type St } from './engine'
import { Objects } from './render'
import type { Scene } from './types'
import { validateScene } from './validate'
import './anim.css'

const DUR = 520
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const Ico = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d={d} /></svg>
const I = { prev: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7', play: 'M7 4l13 8-13 8z', pause: 'M7 5v14M17 5v14', restart: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5' }

export function SceneErrors({ errors }: { errors: string[] }) {
  return <div class="anim-err" role="alert"><b>Scene is invalid</b><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
}

export function AnimPlayer({ scene, autoplay = false, startStep = 0, step, onStep, class: klass = '' }: { scene: Scene; autoplay?: boolean; startStep?: number; step?: number; onStep?: (i: number) => void; class?: string }) {
  const check = useMemo(() => validateScene(scene), [scene])
  if (!check.ok) return <SceneErrors errors={check.errors} />
  return <Player scene={scene} autoplay={autoplay} startStep={startStep} step={step} onStep={onStep} klass={klass} />
}

function Player({ scene, autoplay, startStep, step: ext, onStep, klass }: { scene: Scene; autoplay: boolean; startStep: number; step?: number; onStep?: (i: number) => void; klass: string }) {
  const n = scene.steps.length
  const [i, setI] = useState(Math.min(Math.max(startStep, 0), n - 1))
  const [playing, setPlaying] = useState(autoplay && !reduced())
  const [katex, setKatex] = useState<any>(null)
  const [w, setW] = useState(360)
  const vb = scene.viewBox ?? [0, 0, 360, 240]
  const objs = useMemo(() => byId(scene), [scene])
  const [view, setView] = useState(() => { const st = stateAt(scene, i); return { st, fr: targetFrame(scene, st), e: 1 } })
  const frameRef = useRef<Frame | null>(null)
  const previousStep = useRef(i)
  const raf = useRef(0)
  const root = useRef<HTMLElement>(null)
  const needsMath = scene.objects.some((o) => o.kind === 'math')

  useEffect(() => { if (needsMath) loadKatex().then(setKatex) }, [needsMath])
  useEffect(() => {
    const el = root.current; if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth || 360)); ro.observe(el); return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const st: St = stateAt(scene, i), to = targetFrame(scene, st), from = frameRef.current
    const fromStep = previousStep.current
    previousStep.current = i
    const crossed = Math.abs(i - fromStep) === 1 ? scene.steps[Math.max(i, fromStep)] : undefined
    const moves = crossed?.move ? Array.isArray(crossed.move) ? crossed.move : [crossed.move] : []
    const arcs = Object.fromEntries(moves.filter((m) => m.arc).map((m) => [m.id, m.arc!]))
    cancelAnimationFrame(raf.current)
    if (!from || reduced()) { frameRef.current = to; setView({ st, fr: to, e: 1 }); return }
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DUR), e = easeOut(p)
      const fr = p >= 1 ? to : mixFrame(from, to, st.drawing, e, arcs)
      frameRef.current = fr; setView({ st, fr, e }); if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [i, scene])

  useEffect(() => { if (ext !== undefined && ext !== i) setI(Math.min(n - 1, Math.max(0, ext))) }, [ext])
  useEffect(() => { onStep?.(i) }, [i])
  const go = useCallback((k: number) => setI((c) => Math.min(n - 1, Math.max(0, typeof k === 'number' ? k : c))), [n])
  const manual = (k: number) => { setPlaying(false); go(k) }
  useEffect(() => {
    if (!playing) return
    if (i >= n - 1) return void setPlaying(false)
    const t = setTimeout(() => setI(i + 1), 2200 + scene.steps[i].caption.length * 35)
    return () => clearTimeout(t)
  }, [playing, i, n, scene])

  const key = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || e.altKey || e.ctrlKey || e.metaKey) return
    const m: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }
    if (e.key in m) { e.preventDefault(); manual(m[e.key]) }
  }
  const sw = useRef<{ x: number; y: number } | null>(null)
  const scale = w / vb[2]
  const step = scene.steps[i]
  const fs = useCallback((s: number) => Math.max(s, 12 / scale), [scale])
  const atEnd = i >= n - 1

  return <figure ref={root} class={'anim ' + klass} role="group" aria-roledescription="step-by-step animation" aria-label={scene.title} tabIndex={0} onKeyDown={key}>
    <div class="anim-stage"
      onPointerDown={(e) => { sw.current = { x: e.clientX, y: e.clientY } }}
      onPointerUp={(e) => {
        const s = sw.current; sw.current = null; if (!s) return
        const dx = e.clientX - s.x, dy = e.clientY - s.y
        if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) manual(i + (dx < 0 ? 1 : -1))
      }}
      onPointerCancel={() => { sw.current = null }}>
      <svg viewBox={vb.join(' ')} role="img" aria-label={`${scene.title}. Step ${i + 1} of ${n}: ${step.caption}`} class="anim-svg">
        <Objects c={{ scene, objs, st: view.st, fr: view.fr, e: view.e, fs, katex }} />
      </svg>
    </div>
    <div class="anim-cap" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
      {scene.steps.map((s, k) => k === i
        ? <div key={k} class="acap aon"><Md text={s.caption} />{s.math && <Md text={s.math.includes('$') ? s.math : `$$${s.math}$$`} class="cap-math" />}</div>
        : <div key={k} class="acap aoff" aria-hidden="true">{s.caption + (s.math ? ' ' + s.math : '')}</div>)}
    </div>
    <div class="anim-dots" role="group" aria-label="Steps">
      {scene.steps.map((_, k) => <button key={k} type="button" class={'adot' + (k === i ? ' aon' : k < i ? ' adone' : '')} aria-label={`Step ${k + 1} of ${n}`} aria-current={k === i ? 'step' : undefined} onClick={() => manual(k)}><i /></button>)}
    </div>
    <div class="anim-ctl">
      <button type="button" class="ab aicon" aria-label="Restart" title="Restart" onClick={() => manual(0)} disabled={i === 0}><Ico d={I.restart} /></button>
      <button type="button" class="ab" onClick={() => manual(i - 1)} disabled={i === 0}><Ico d={I.prev} />Prev</button>
      <button type="button" class="ab play" aria-pressed={playing} onClick={() => { if (!playing && atEnd) setI(0); setPlaying(!playing) }}><Ico d={playing ? I.pause : I.play} />{playing ? 'Pause' : 'Play'}</button>
      <button type="button" class="ab aprimary" onClick={() => manual(i + 1)} disabled={atEnd}>Next<Ico d={I.next} /></button>
    </div>
    <div class="anim-count" aria-hidden="true">{i + 1} / {n}</div>
  </figure>
}
