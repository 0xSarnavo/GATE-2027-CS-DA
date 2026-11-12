/** @jsxImportSource preact */
import type { JSX } from 'preact'
import { axisPt, cellRect, layoutTree, makeFn, type Frame, type Hl, type St, type Xy } from './engine'
import type { ArrayObj, AxisObj, BarObj, Cell, EdgeObj, GridObj, MatrixObj, PointerObj, Scene, SceneObject, Tone, TreeObj } from './types'

export interface Ctx {
  scene: Scene; objs: Record<string, SceneObject>; st: St; fr: Frame
  e: number // eased progress of the current step transition, 0..1
  fs: (n: number) => number // font size clamped so it renders at >= 12px
  katex: any
}
const TONE: Record<Tone, string> = { accent: 'var(--accent)', good: 'var(--good)', bad: 'var(--bad)', mid: 'var(--mid)', muted: 'var(--muted)' }
const num = (c: Cell | undefined) => (c === undefined ? '' : String(c))

const P = <T extends SceneObject>(c: Ctx, o: T): T => ({ ...o, ...c.st.props[o.id] })
const pos = (c: Ctx, o: SceneObject): Xy => c.fr.num[o.id] ?? { x: 0, y: 0 }
function tone(o: SceneObject, hl?: Hl, over?: Tone): Tone | undefined { return hl?.tone ?? over ?? (o as any).tone }
const toneStyle = (t?: Tone) => (t ? ({ '--tone': TONE[t] } as JSX.CSSProperties) : undefined)
const cls = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(' ')
const cellHl = (hl: Hl | undefined, i: number) => !!hl && (!hl.cells || hl.cells.has(i))
const cellDim = (c: Ctx, id: string, i: number) => { const d = c.st.dim[id]; return d === 'all' || (d instanceof Set && d.has(i)) }

/** Keep leading/consecutive spaces (code-like captions). */
const PRE = { 'xml:space': 'preserve', style: { whiteSpace: 'pre' } } as any
const CELLED = new Set(['array', 'grid', 'bar'])

function T({ x, y, children, size, anchor = 'middle', cls: k, c }: { x: number; y: number; children: any; size: number; anchor?: string; cls?: string; c: Ctx }) {
  return <text class={cls('lbl', k)} x={x} y={y} font-size={c.fs(size)} text-anchor={anchor} {...PRE}>{children}</text>
}

function Head({ x1, y1, x2, y2, len = 9 }: { x1: number; y1: number; x2: number; y2: number; len?: number }) {
  const a = Math.atan2(y2 - y1, x2 - x1), w = 0.42
  const p = (d: number) => `${x2 - len * Math.cos(a + d)},${y2 - len * Math.sin(a + d)}`
  return <polygon class="head" points={`${x2},${y2} ${p(w)} ${p(-w)}`} />
}

/** Clip a segment between two shapes (circle or rect centred on its position) so lines meet the outlines. */
function anchor(c: Ctx, id: string, toward: Xy): { p: Xy; r: number } | null {
  const o = c.objs[id]; if (!o) return null
  const q = pos(c, o)
  const dx = toward.x - q.x, dy = toward.y - q.y, d = Math.hypot(dx, dy) || 1
  if (o.kind === 'node') return { p: q, r: o.r ?? 20 }
  if (o.kind === 'box') {
    const cx = q.x + o.w / 2, cy = q.y + o.h / 2, ex = toward.x - cx, ey = toward.y - cy
    const k = Math.min(Math.abs(o.w / 2 / (ex || 1e-9)), Math.abs(o.h / 2 / (ey || 1e-9)))
    return { p: { x: cx, y: cy }, r: Math.hypot(ex, ey) * Math.min(1, k) }
  }
  void d
  return { p: q, r: 0 }
}
const center = (c: Ctx, id: string): Xy | null => {
  const o = c.objs[id]; if (!o) return null
  const q = pos(c, o); return o.kind === 'box' ? { x: q.x + o.w / 2, y: q.y + o.h / 2 } : q
}

function Edge({ c, o, hl }: { c: Ctx; o: EdgeObj; hl?: Hl }) {
  const d = c.fr.draw[o.id] ?? 1
  let a: Xy, b: Xy
  if (o.from != null) {
    const ca = center(c, o.from), cb = center(c, o.to!)
    if (!ca || !cb) return null
    const aa = anchor(c, o.from, cb)!, ab = anchor(c, o.to!, ca)!
    const L = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1, ux = (cb.x - ca.x) / L, uy = (cb.y - ca.y) / L
    const gap = o.kind === 'arrow' ? 2 : 0
    a = { x: ca.x + ux * (aa.r + gap), y: ca.y + uy * (aa.r + gap) }
    b = { x: cb.x - ux * (ab.r + gap), y: cb.y - uy * (ab.r + gap) }
  } else { a = { x: o.x1!, y: o.y1! }; b = { x: o.x2!, y: o.y2! } }
  const e = { x: a.x + (b.x - a.x) * d, y: a.y + (b.y - a.y) * d }
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L
  return <g>
    <line class={cls('aln', o.dash && 'dash')} x1={a.x} y1={a.y} x2={e.x} y2={e.y} />
    {o.kind === 'arrow' && d > 0.9 && <Head x1={a.x} y1={a.y} x2={b.x} y2={b.y} />}
    {o.label && d > 0.6 && <T c={c} x={(a.x + b.x) / 2 + nx * 12} y={(a.y + b.y) / 2 + ny * 12} size={12} cls="halo">{o.label}</T>}
  </g>
}

function Multi({ c, text, x, y, size, anchor: an, cls: k }: { c: Ctx; text: string; x: number; y: number; size: number; anchor?: string; cls?: string }) {
  const lines = text.split('\n'), lh = c.fs(size) * 1.25, y0 = y - ((lines.length - 1) * lh) / 2
  return <text class={cls('lbl', k)} font-size={c.fs(size)} text-anchor={an ?? 'middle'} {...PRE}>
    {lines.map((l, i) => <tspan key={i} x={x} y={y0 + i * lh}>{l}</tspan>)}
  </text>
}

function ArrayView({ c, o, hl }: { c: Ctx; o: ArrayObj; hl?: Hl }) {
  const cells = (c.st.props[o.id]?.cells ?? o.cells) as Cell[]
  const cw = o.cw ?? 36, ch = o.ch ?? 36, dir = o.dir ?? 'right', e = c.e
  const pushed = c.st.pushed.filter((p) => p.id === o.id).map((p) => p.index)
  const pops = c.st.popped.filter((p) => p.id === o.id)
  const front = pops.some((p) => p.front)
  const swaps = c.st.swaps.filter((s) => s.id === o.id)
  const slots = Math.max(o.slots ?? 0, cells.length)
  const showIdx = o.indices ?? dir === 'right'
  const r0 = cellRect(o, 0)
  const cellG = (i: number, v: Cell, extra: { dx?: number; dy?: number; op?: number; key: string }) => {
    const r = cellRect(o, i)
    const on = cellHl(hl, i)
    return <g key={extra.key} transform={`translate(${extra.dx ?? 0} ${extra.dy ?? 0})`} opacity={(extra.op ?? 1) * (cellDim(c, o.id, i) ? 0.35 : 1)}>
      <rect class={cls('sh', on && 'aon')} x={r.x} y={r.y} width={r.w} height={r.h} rx={6} />
      <T c={c} x={r.x + r.w / 2} y={r.y + r.h / 2} size={14}>{num(v)}</T>
    </g>
  }
  return <g>
    {o.label && <T c={c} x={r0.x} y={(dir === 'up' ? cellRect(o, Math.max(slots, 1) - 1).y : r0.y) - 9} size={12} anchor="start" cls="amuted">{o.label}</T>}
    {Array.from({ length: slots }, (_, i) => { const r = cellRect(o, i); return <rect key={'s' + i} class="slot" x={r.x} y={r.y} width={r.w} height={r.h} rx={6} /> })}
    {cells.map((v, i) => {
      let dx = 0, dy = 0, op = 1
      if (front && dir === 'right') dx = cw * (1 - e)
      if (pushed.includes(i)) { op = e; dy = (dir === 'right' ? -10 : -14) * (1 - e) }
      const sw = swaps.find((s) => s.i === i || s.j === i)
      if (sw) dx = ((sw.i === i ? sw.j : sw.i) - i) * cw * (1 - e)
      return cellG(i, v, { dx, dy, op, key: 'c' + i })
    })}
    {pops.map((p, k) => cellG(p.index, p.value, { dx: p.front ? -cw * 0.6 * e : 0, dy: p.front ? 0 : -16 * e, op: 1 - e, key: 'p' + k }))}
    {showIdx && Array.from({ length: slots }, (_, i) => { const r = cellRect(o, i); return <T key={'i' + i} c={c} x={r.x + r.w / 2} y={r.y + r.h + 13} size={11} cls="amuted">{i}</T> })}
    {dir !== 'right' && showIdx && null}
  </g>
}

function PointerView({ c, o, hl }: { c: Ctx; o: PointerObj; hl?: Hl }) {
  const A = c.objs[o.array] as ArrayObj | undefined; if (!A) return null
  const f = c.fr.num[o.id]?.x ?? o.index
  const r = cellRect(A, f)
  const side = o.side ?? (A.dir === 'up' || A.dir === 'down' ? 'right' : 'below')
  const idx = (A.indices ?? (A.dir ?? 'right') === 'right') ? 24 : 3
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  let tip: Xy, tail: Xy, lab: Xy, an = 'middle'
  if (side === 'below') { tip = { x: cx, y: r.y + r.h + idx }; tail = { x: cx, y: tip.y + 22 }; lab = { x: cx, y: tail.y + 12 } }
  else if (side === 'above') { tip = { x: cx, y: r.y - 3 }; tail = { x: cx, y: tip.y - 22 }; lab = { x: cx, y: tail.y - 11 } }
  else if (side === 'right') { tip = { x: r.x + r.w + 4, y: cy }; tail = { x: tip.x + 24, y: cy }; lab = { x: tail.x + 4, y: cy }; an = 'start' }
  else { tip = { x: r.x - 4, y: cy }; tail = { x: tip.x - 24, y: cy }; lab = { x: tail.x - 4, y: cy }; an = 'end' }
  return <g class="ptr">
    <line class="aln" x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} />
    <Head x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} />
    {o.label && <T c={c} x={lab.x} y={lab.y} size={13} anchor={an} cls="bold tonefill">{o.label}</T>}
    {void hl}
  </g>
}

function GridView({ c, o, hl }: { c: Ctx; o: GridObj; hl?: Hl }) {
  const cw = o.cw ?? 40, ch = o.ch ?? 40, x0 = o.x ?? 0, y0 = o.y ?? 0
  const raw = (c.st.props[o.id]?.cells ?? o.cells ?? []) as any[]
  const get = (r: number, k: number) => (Array.isArray(raw[0]) ? raw[r]?.[k] : raw[r * o.cols + k])
  const out = []
  for (let r = 0; r < o.rows; r++) for (let k = 0; k < o.cols; k++) {
    const i = r * o.cols + k, on = cellHl(hl, i)
    out.push(<g key={i} opacity={cellDim(c, o.id, i) ? 0.35 : 1}>
      <rect class={cls('sh', on && 'aon')} x={x0 + k * cw} y={y0 + r * ch} width={cw} height={ch} />
      <T c={c} x={x0 + k * cw + cw / 2} y={y0 + r * ch + ch / 2} size={15}>{num(get(r, k))}</T>
    </g>)
  }
  return <g>
    {out}
    {o.colLabels?.map((l, k) => <T key={'c' + k} c={c} x={x0 + k * cw + cw / 2} y={y0 - 9} size={12} cls="amuted">{l}</T>)}
    {o.rowLabels?.map((l, r) => <T key={'r' + r} c={c} x={x0 - 8} y={y0 + r * ch + ch / 2} size={12} anchor="end" cls="amuted">{l}</T>)}
    {o.colTitle && <T c={c} x={x0 + (o.cols * cw) / 2} y={y0 - 26} size={13} cls="bold">{o.colTitle}</T>}
    {o.rowTitle && <T c={c} x={x0 - 40} y={y0 + (o.rows * ch) / 2} size={13} cls="bold">{o.rowTitle}</T>}
  </g>
}

function MatrixView({ c, o, hl }: { c: Ctx; o: MatrixObj; hl?: Hl }) {
  const vals = (c.st.props[o.id]?.values ?? o.values) as Cell[][]
  const cw = o.cw ?? 34, ch = o.ch ?? 30, x0 = o.x ?? 0, y0 = o.y ?? 0, h = vals.length * ch, w = (vals[0]?.length ?? 0) * cw
  const br = (x: number, dir: number) => `M${x + dir * 6},${y0 - 2} L${x},${y0 - 2} L${x},${y0 + h + 2} L${x + dir * 6},${y0 + h + 2}`
  return <g>
    <path class="aln" fill="none" d={br(x0 - 4, 1)} /><path class="aln" fill="none" d={br(x0 + w + 4, -1)} />
    {vals.map((row, r) => row.map((v, k) => {
      const i = r * row.length + k, on = cellHl(hl, i)
      return <g key={i} opacity={cellDim(c, o.id, i) ? 0.35 : 1}>
        {on && <rect class="sh aon" x={x0 + k * cw + 2} y={y0 + r * ch + 2} width={cw - 4} height={ch - 4} rx={5} />}
        <T c={c} x={x0 + k * cw + cw / 2} y={y0 + r * ch + ch / 2} size={15}>{num(v)}</T>
      </g>
    }))}
    {o.label && <T c={c} x={x0 - 12} y={y0 + h / 2} size={14} anchor="end" cls="bold">{o.label}</T>}
  </g>
}

function BarView({ c, o, hl }: { c: Ctx; o: BarObj; hl?: Hl }) {
  const vals = (c.st.props[o.id]?.values ?? o.values) as number[]
  const w = o.w ?? 240, h = o.h ?? 100, x0 = o.x ?? 0, y0 = o.y ?? 0, max = o.max ?? Math.max(...vals, 1e-9)
  const bw = w / vals.length
  return <g>
    <line class="aln" x1={x0} y1={y0 + h} x2={x0 + w} y2={y0 + h} />
    {vals.map((v, i) => {
      const bh = (v / max) * h, on = cellHl(hl, i)
      return <g key={i} opacity={cellDim(c, o.id, i) ? 0.35 : 1}>
        <rect class={cls('sh abar', on && 'aon')} x={x0 + i * bw + bw * 0.15} y={y0 + h - bh} width={bw * 0.7} height={bh} rx={3} />
        {!(o.hideZero && v === 0) && <T c={c} x={x0 + i * bw + bw / 2} y={y0 + h - bh - 8} size={12}>{+v.toFixed(3)}</T>}
        {o.labels?.[i] != null && <T c={c} x={x0 + i * bw + bw / 2} y={y0 + h + 14} size={12} cls="amuted">{o.labels[i]}</T>}
      </g>
    })}
  </g>
}

function AxisView({ c, o }: { c: Ctx; o: AxisObj }) {
  const u = o.unit ?? 40, [xa, xb] = o.xr ?? [-3, 3], [ya, yb] = o.yr ?? [-3, 3]
  const ox = o.x ?? 0, oy = o.y ?? 0
  const [vx, vy, vw] = c.scene.viewBox ?? [0, 0, 360, 240]
  const widest = Math.max(String(Math.ceil(xa)).length, String(Math.floor(xb)).length)
  const step = (min: number) => { let n = 1, k = 0; while (u > 0 && n * u < min) { k++; n = [1, 2, 5][k % 3] * 10 ** Math.floor(k / 3) } return n }
  const xs = step(widest * c.fs(11) * 0.6 + 6), ys = step(c.fs(11) * 1.3)
  const font = c.fs(11)
  const yBoxes: [number, number, number, number][] = []
  for (let i = Math.ceil(ya); i <= yb; i++) if (i && i % ys === 0) {
    const y = oy - i * u
    yBoxes.push([ox - 7 - String(i).length * font * 0.6, y - font, ox - 7, y])
  }
  const ticks: JSX.Element[] = []
  for (let i = Math.ceil(xa); i <= xb; i++) if (i && (u >= 10 || i % xs === 0)) {
    const x = ox + i * u, halfWidth = String(i).length * font * 0.3
    const overlapsY = yBoxes.some(([left, top, right, bottom]) => x - halfWidth < right && x + halfWidth > left && oy + 14 - font < bottom && oy + 14 > top)
    ticks.push(<g key={'x' + i}><line class="agrid" x1={x} y1={oy - yb * u} x2={x} y2={oy - ya * u} />{i % xs === 0 && !overlapsY && <T c={c} x={x} y={oy + 14} size={11} cls="amuted">{i}</T>}</g>)
  }
  for (let i = Math.ceil(ya); i <= yb; i++) if (i && (u >= 10 || i % ys === 0)) ticks.push(<g key={'y' + i}><line class="agrid" x1={ox + xa * u} y1={oy - i * u} x2={ox + xb * u} y2={oy - i * u} />{i % ys === 0 && <T c={c} x={ox - 7} y={oy - i * u} size={11} anchor="end" cls="amuted">{i}</T>}</g>)
  const xEnd = ox + xb * u, xWrap = !!o.xlabel && xEnd + 6 + o.xlabel.length * c.fs(13) * 0.6 > vx + vw
  const yTop = oy - yb * u - 8, yWrap = yTop - c.fs(13) < vy
  return <g>
    {ticks}
    <line class="aln" x1={ox + xa * u} y1={oy} x2={ox + xb * u} y2={oy} /><Head x1={ox + xa * u} y1={oy} x2={ox + xb * u + 4} y2={oy} len={7} />
    <line class="aln" x1={ox} y1={oy - ya * u} x2={ox} y2={oy - yb * u} /><Head x1={ox} y1={oy - ya * u} x2={ox} y2={oy - yb * u - 4} len={7} />
    {o.xlabel && <T c={c} x={xWrap ? Math.min(xEnd + 4, vx + vw) : xEnd + 6} y={oy + (xWrap ? -12 : 14)} size={13} anchor={xWrap ? 'end' : 'start'} cls="bold">{o.xlabel}</T>}
    {o.ylabel && <T c={c} x={ox + 8} y={yWrap ? vy + c.fs(13) : yTop} size={13} anchor="start" cls="bold">{o.ylabel}</T>}
  </g>
}

function TreeView({ c, o, hl }: { c: Ctx; o: TreeObj; hl: Record<string, Hl> }) {
  const r = o.r ?? 16, L = layoutTree(o.root, o.dx, o.dy), q = pos(c, o), x0 = q.x - L.w / 2
  return <g>
    {L.edges.map(([a, b], i) => <line key={i} class="aln" x1={x0 + L.nodes[a].x} y1={q.y + L.nodes[a].y} x2={x0 + L.nodes[b].x} y2={q.y + L.nodes[b].y} />)}
    {L.nodes.map((n, i) => {
      const h = n.id ? hl[n.id] : undefined
      return <g key={i} class={cls('o', h && 'hl', (h || (o as any).tone) && 'atone')} style={toneStyle(tone(o, h))}>
        <circle class="sh" cx={x0 + n.x} cy={q.y + n.y} r={r} />
        <T c={c} x={x0 + n.x} y={q.y + n.y} size={13}>{n.label}</T>
      </g>
    })}
  </g>
}

function Body({ c, o: raw, hl }: { c: Ctx; o: SceneObject; hl?: Hl }) {
  const o = P(c, raw) as any, q = pos(c, raw)
  switch (o.kind) {
    case 'node': return <g><circle class="sh" cx={q.x} cy={q.y} r={o.r ?? 20} /><T c={c} x={q.x} y={q.y} size={13}>{o.label}</T></g>
    case 'edge': case 'arrow': return <Edge c={c} o={o} hl={hl} />
    case 'box': return <g>
      <rect class={cls('sh', o.fill === false && 'nofill', o.dash && 'dash')} x={q.x} y={q.y} width={o.w} height={o.h} rx={o.square ? 0 : 8} />
      {o.label && <T c={c} x={q.x + o.w / 2} y={q.y + o.h / 2} size={13}>{o.label}</T>}
    </g>
    case 'circle': return <circle class="venn" cx={q.x} cy={q.y} r={o.r} fill="var(--tone, var(--accent))" fill-opacity={o.fillOpacity ?? 0.25} stroke="var(--tone, var(--accent))" stroke-width={2} />
    case 'text': return <Multi c={c} text={o.text} x={q.x} y={q.y} size={o.size ?? 14} anchor={o.anchor} cls={cls(o.bold && 'bold', o.mono && 'mono', (hl || o.tone) && 'tonefill')} />
    case 'math': {
      const w = o.w ?? 220, h = o.h ?? 36, an = o.anchor ?? 'middle'
      const html = c.katex ? c.katex.renderToString(o.tex, { throwOnError: false }) : ''
      return <foreignObject x={an === 'middle' ? q.x - w / 2 : an === 'end' ? q.x - w : q.x} y={q.y - h / 2} width={w} height={h}>
        <div class="mathbox" style={{ fontSize: c.fs(o.size ?? 16) + 'px', justifyContent: an === 'middle' ? 'center' : an === 'end' ? 'flex-end' : 'flex-start' }} dangerouslySetInnerHTML={{ __html: html || '<span aria-label="Loading formula">…</span>' }} />
      </foreignObject>
    }
    case 'array': return <ArrayView c={c} o={o} hl={hl} />
    case 'matrix': return <MatrixView c={c} o={o} hl={hl} />
    case 'grid': return <GridView c={c} o={o} hl={hl} />
    case 'bar': return <BarView c={c} o={o} hl={hl} />
    case 'axis': return <AxisView c={c} o={o} />
    case 'pointer': return <PointerView c={c} o={o} hl={hl} />
    case 'tree': return <TreeView c={c} o={o} hl={c.st.hl} />
    case 'point': case 'vector': case 'curve': {
      const ax = c.objs[o.axis] as AxisObj | undefined; if (!ax) return null
      const d = c.fr.draw[o.id] ?? 1
      if (o.kind === 'point') {
        const p = axisPt(ax, [q.x, q.y])
        return <g><circle class={cls('adot', o.hollow && 'hollow')} cx={p.x} cy={p.y} r={5} />{o.label && <T c={c} x={p.x + 9} y={p.y - 9} size={13} anchor="start" cls="halo bold">{o.label}</T>}</g>
      }
      if (o.kind === 'vector') {
        const a = axisPt(ax, o.from ?? [0, 0]), b = axisPt(ax, [q.x, q.y])
        const e = { x: a.x + (b.x - a.x) * d, y: a.y + (b.y - a.y) * d }
        const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
        return <g>
          <line class={cls('aln vec', o.dash && 'dash')} x1={a.x} y1={a.y} x2={e.x} y2={e.y} />
          {L > 4 && d > 0.9 && <Head x1={a.x} y1={a.y} x2={b.x} y2={b.y} len={11} />}
          {o.label && <T c={c} x={b.x + ((b.x - a.x) / L) * 16 + 4} y={b.y + ((b.y - a.y) / L) * 14 - 2} size={13} cls="halo bold tonefill">{o.label}</T>}
        </g>
      }
      let pts: ([number, number] | null)[] = o.points
      if (!pts) {
        const f = makeFn(o.fn), [a, b] = o.domain ?? ax.xr ?? [-3, 3], [, vy, , vh] = c.scene.viewBox ?? [0, 0, 360, 240]
        pts = []
        for (let i = 0; i <= 80; i++) { const x = a + ((b - a) * i) / 80, y = f(x), s = axisPt(ax, [x, y]); pts.push(Number.isFinite(s.x) && Number.isFinite(s.y) && s.y >= vy - 30 && s.y <= vy + vh + 30 ? [x, y] : null) }
      }
      let move = true
      const dd = pts.map((p) => { if (!p) { move = true; return '' } const s = axisPt(ax, p), cmd = move ? 'M' : 'L'; move = false; return cmd + s.x.toFixed(1) + ',' + s.y.toFixed(1) }).join('')
      return <path class={cls('aln curve', o.dash && 'dash')} fill="none" d={dd} pathLength={1} stroke-dasharray={d < 1 ? `${d} 1` : undefined} />
    }
  }
  return null
}

export function Objects({ c }: { c: Ctx }) {
  return <>{c.scene.objects.map((o) => {
    const op = (c.fr.vis[o.id] ?? 1) * (c.st.dim[o.id] && !CELLED.has(o.kind) ? 0.35 : 1)
    if (op <= 0.001) return null
    const hl = c.st.hl[o.id]
    const t = tone(o, hl, c.st.props[o.id]?.tone)
    const cellMode = !!hl?.cells // only some cells are lit: set --tone but don't tint the whole object
    return <g key={o.id} class={cls('o', 'k-' + o.kind, hl && !cellMode && 'hl', t && !cellMode && 'atone')} style={toneStyle(t)} opacity={op}>
      <Body c={c} o={o} hl={hl} />
    </g>
  })}</>
}
