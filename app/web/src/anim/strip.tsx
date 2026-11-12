// Dev only, for the central visual check: every step of every scene in one explainer, as static frames.
// From app/: bunx vite web --port 5199, then open /src/anim/strip.html?t=<topic>[&s=<sceneId>,<sceneId>]
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import '../styles.css'
import './anim.css'
import { loadKatex } from '../md'
import { byId, stateAt, targetFrame } from './engine'
import { Objects } from './render'
import type { Scene } from './types'

const files = import.meta.glob('../../../data/explainers/*.json', { import: 'default' }) as Record<string, () => Promise<any>>
const q = new URLSearchParams(location.search)
const topic = q.get('t') ?? '', only = q.get('s')?.split(',')

function Frames({ scene, katex }: { scene: Scene; katex: any }) {
  const vb = scene.viewBox ?? [0, 0, 360, 240], objs = byId(scene), scale = 380 / vb[2]
  const fs = (n: number) => Math.max(n, 12 / scale)
  return <section style={{ margin: '0 0 28px' }}>
    <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{scene.id}</h2>
    {scene.steps.map((s, k) => {
      const st = stateAt(scene, k)
      return <div key={k} style={{ marginBottom: 10 }} data-scene={scene.id} data-step={k + 1}>
        <div class="anim-stage"><svg viewBox={vb.join(' ')} class="anim-svg"><Objects c={{ scene, objs, st, fr: targetFrame(scene, st), e: 1, fs, katex }} /></svg></div>
        <p style={{ fontSize: 13, margin: '4px 2px 0' }}><b>{k + 1}.</b> {s.caption}</p>
      </div>
    })}
  </section>
}

// Measures real rendered labels: text outside the stage, text boxes overlapping, math wider than its box.
// Returns one line per scene+issue, with the steps where it happens.
function audit() {
  const hits = new Map<string, number[]>()
  const add = (scene: string, step: number, msg: string) => { const k = scene + ': ' + msg; hits.set(k, [...(hits.get(k) ?? []), step]) }
  document.querySelectorAll<HTMLElement>('[data-scene]').forEach((f) => {
    const svg = f.querySelector('svg')!, R = svg.getBoundingClientRect(), sc = f.dataset.scene!, st = Number(f.dataset.step)
    const seen = (el: Element) => { let op = 1; for (let e: Element | null = el; e && e !== svg; e = e.parentElement) op *= Number(e.getAttribute('opacity') ?? 1); return op > 0.05 }
    const rects = [...svg.querySelectorAll('text')].filter(seen).map((t) => ({ t: (t.textContent ?? '').slice(0, 40), r: t.getBoundingClientRect() })).filter((x) => x.r.width > 0)
    for (const { t, r } of rects) if (r.left < R.left - 1 || r.right > R.right + 1 || r.top < R.top - 1 || r.bottom > R.bottom + 1) add(sc, st, `outside stage: "${t}"`)
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r, b = rects[j].r, w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (w > 2 && h > 3) add(sc, st, `overlap: "${rects[i].t.slice(0, 30)}" / "${rects[j].t.slice(0, 30)}"`)
    }
    svg.querySelectorAll<HTMLElement>('.mathbox').forEach((m) => {
      const k = m.querySelector<HTMLElement>('.katex') ?? m, r = k.getBoundingClientRect()
      if (k.scrollWidth > m.clientWidth + 2 || r.left < R.left - 1 || r.right > R.right + 1) add(sc, st, `math too wide or outside: "${(m.textContent ?? '').slice(0, 40)}"`)
    })
  })
  return [...hits].map(([k, steps]) => `${k} [steps ${steps.join(',')}]`)
}

// Hidden tabs throttle setTimeout; a MessageChannel tick is not throttled.
const tick = () => new Promise<void>((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0) })
async function until(ok: () => boolean, ms = 15000) { const t0 = performance.now(); while (!ok()) { if (performance.now() - t0 > ms) throw new Error('timeout'); await tick() } }

function Strip() {
  const [t, setT] = useState(topic)
  const [d, setD] = useState<any>(null), [katex, setKatex] = useState<any>(null)
  const key = Object.keys(files).find((p) => p.endsWith('/' + t + '.json'))
  useEffect(() => { setD(null); if (key) files[key]().then((v) => setD({ ...v, __t: t })) }, [key])
  useEffect(() => { loadKatex().then((k) => { setKatex(k); (window as any).__katexReady = true }) }, [])
  // Audit hook for the visual check: await __audit(topic) -> list of issues
  ;(window as any).__topics = Object.keys(files).map((p) => p.split('/').pop()!.replace('.json', ''))
  ;(window as any).__audit = async (x: string) => {
    setT(x)
    await until(() => document.querySelector('h1')?.dataset.ready === x && (!document.querySelector('[data-scene]') || !!(window as any).__katexReady))
    for (let k = 0; k < 50; k++) await tick()
    return audit()
  }
  if (!key) return <p>No explainer {t}. Use ?t=topic</p>
  if (!d) return <p>Loading…</p>
  const scenes: Scene[] = (d.scenes ?? []).filter((s: Scene) => !only || only.includes(s.id))
  return <div style={{ padding: 16, maxWidth: 412, margin: '0 auto' }}>
    <h1 style={{ fontSize: 17 }} data-ready={d.__t}>{t}: {scenes.length} scenes</h1>
    {scenes.map((s) => <Frames key={s.id} scene={s} katex={katex} />)}
  </div>
}
render(<Strip />, document.getElementById('app')!)
