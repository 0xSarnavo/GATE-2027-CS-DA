import type { ArrayObj, AxisObj, Cell, GridObj, HighlightRef, Scene, SceneObject, Tone, TreeNode, Vec2 } from './types'

const arr = <T,>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x])

export interface Hl { tone: Tone; cells?: Set<number> }
export interface Xy { x: number; y: number }
/** Discrete state after replaying steps 0..i. Positions, visibility and draw progress are tweened separately (Frame). */
export interface St {
  vis: Set<string>; num: Record<string, Xy>; props: Record<string, any>
  hl: Record<string, Hl>; dim: Record<string, Set<number> | 'all'>
  drawing: Set<string>
  swaps: { id: string; i: number; j: number }[]
  pushed: { id: string; index: number }[]
  popped: { id: string; value: Cell; index: number; front: boolean }[]
}
export interface Frame { vis: Record<string, number>; num: Record<string, Xy>; draw: Record<string, number> }

export const byId = (s: Scene) => Object.fromEntries(s.objects.map((o) => [o.id, o])) as Record<string, SceneObject>

export function baseNum(o: SceneObject): Xy {
  switch (o.kind) {
    case 'point': return { x: o.at[0], y: o.at[1] }
    case 'circle': return { x: o.cx, y: o.cy }
    case 'vector': return { x: o.to[0], y: o.to[1] }
    case 'pointer': return { x: o.index, y: 0 }
    case 'edge': case 'arrow': case 'curve': return { x: 0, y: 0 }
    default: return { x: (o as any).x ?? 0, y: (o as any).y ?? 0 }
  }
}

/** Flat cell index from a number or [row, col]. */
const flat = (c: number | Vec2, o?: SceneObject) => (Array.isArray(c) ? c[0] * ((o as GridObj)?.cols ?? (o as any)?.values?.[0]?.length ?? 1) + c[1] : c)

const clone = <T,>(v: T): T => (v !== null && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v)

/** Pure: never mutates `scene`. Within one step ops apply in this order: set, swap, pop, push. */
export function stateAt(scene: Scene, upto: number): St {
  const objs = byId(scene)
  const gated = new Set<string>()
  scene.steps.forEach((s) => [...arr(s.show), ...arr(s.hide)].forEach((id) => gated.add(id)))
  const st: St = {
    vis: new Set(scene.objects.filter((o) => !gated.has(o.id)).map((o) => o.id)),
    num: Object.fromEntries(scene.objects.map((o) => [o.id, baseNum(o)])),
    props: {}, hl: {}, dim: {}, drawing: new Set(), swaps: [], pushed: [], popped: [],
  }
  const cellsOf = (id: string): Cell[] => (st.props[id] ??= {}).cells ??= clone((objs[id] as ArrayObj).cells ?? [])
  for (let k = 0; k <= upto && k < scene.steps.length; k++) {
    const s = scene.steps[k]
    st.hl = {}; st.drawing = new Set(); st.swaps = []; st.pushed = []; st.popped = []
    arr(s.show).forEach((id) => st.vis.add(id))
    arr(s.hide).forEach((id) => st.vis.delete(id))
    arr(s.draw).forEach((id) => { st.drawing.add(id); st.vis.add(id) })
    arr(s.animate).forEach((a) => { st.drawing.add(a.id); st.vis.add(a.id) })
    arr(s.move).forEach((m) => {
      const cur = st.num[m.id] ?? { x: 0, y: 0 }
      st.num[m.id] = { x: m.index ?? m.x ?? cur.x, y: m.y ?? cur.y }
    })
    arr(s.set).forEach(({ id, ...rest }) => {
      const p = (st.props[id] ??= {})
      for (const [key, v] of Object.entries(rest)) if (v !== undefined) p[key] = clone(v)
    })
    arr(s.swap).forEach((w) => { const c = cellsOf(w.id);[c[w.i], c[w.j]] = [c[w.j], c[w.i]]; st.swaps.push(w) })
    arr(s.pop).forEach((p) => {
      const c = cellsOf(p.id); if (!c.length) return
      const front = p.end === 'front'
      const value = front ? c.shift()! : c.pop()!
      st.popped.push({ id: p.id, value, index: front ? 0 : c.length, front })
    })
    arr(s.push).forEach((p) => { const c = cellsOf(p.id); c.push(p.value); st.pushed.push({ id: p.id, index: c.length - 1 }) })
    arr(s.undim).forEach((id) => delete st.dim[id])
    arr(s.dim).forEach((d) => {
      const { id, cells } = typeof d === 'string' ? { id: d, cells: undefined } : d
      if (!cells) return void (st.dim[id] = 'all')
      const cur = st.dim[id]
      if (cur === 'all') return
      const set = (st.dim[id] = cur ?? new Set())
      cells.forEach((c) => set.add(flat(c, objs[id])))
    })
    arr<HighlightRef>(s.highlight).forEach((h) => {
      const r = typeof h === 'string' ? { id: h } as Exclude<HighlightRef, string> : h
      st.hl[r.id] = { tone: r.tone ?? 'accent', cells: r.cells ? new Set(r.cells.map((c) => flat(c, objs[r.id]))) : undefined }
    })
  }
  return st
}

export function targetFrame(scene: Scene, st: St): Frame {
  return {
    vis: Object.fromEntries(scene.objects.map((o) => [o.id, st.vis.has(o.id) ? 1 : 0])),
    num: Object.fromEntries(Object.entries(st.num).map(([k, v]) => [k, { ...v }])),
    draw: Object.fromEntries(scene.objects.map((o) => [o.id, 1])),
  }
}

/** Interpolate from the frame currently on screen to the target; only changed values actually move. */
export function mixFrame(from: Frame, to: Frame, drawing: Set<string>, t: number, arcs: Record<string, { cx: number; cy: number }> = {}): Frame {
  const l = (a: number, b: number) => a + (b - a) * t
  const travel = (id: string, f: Xy, v: Xy): Xy => {
    const arc = arcs[id]
    if (!arc || (f.x === v.x && f.y === v.y)) return { x: l(f.x, v.x), y: l(f.y, v.y) }
    const start = Math.atan2(f.y - arc.cy, f.x - arc.cx)
    const end = Math.atan2(v.y - arc.cy, v.x - arc.cx)
    const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start))
    const radius = Math.hypot(f.x - arc.cx, f.y - arc.cy)
    return { x: arc.cx + radius * Math.cos(start + delta * t), y: arc.cy + radius * Math.sin(start + delta * t) }
  }
  return {
    vis: Object.fromEntries(Object.entries(to.vis).map(([k, v]) => [k, l(from.vis[k] ?? v, v)])),
    num: Object.fromEntries(Object.entries(to.num).map(([k, v]) => { const f = from.num[k] ?? v; return [k, travel(k, f, v)] })),
    draw: Object.fromEntries(Object.keys(to.draw).map((k) => [k, drawing.has(k) ? t : 1])),
  }
}

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

// ---- geometry helpers shared by renderers ----
export interface CellRect { x: number; y: number; w: number; h: number }
export function cellRect(o: ArrayObj, idx: number): CellRect {
  const w = o.cw ?? 36, h = o.ch ?? 36, x = o.x ?? 0, y = o.y ?? 0
  if (o.dir === 'up') return { x, y: y - (idx + 1) * h, w, h }
  if (o.dir === 'down') return { x, y: y + idx * h, w, h }
  return { x: x + idx * w, y, w, h }
}
export const axisPt = (a: AxisObj, p: Vec2): Xy => ({ x: (a.x ?? 0) + p[0] * (a.unit ?? 40), y: (a.y ?? 0) - p[1] * (a.unit ?? 40) })

/** Safe expression compiler for curve `fn` (no eval). Precedence follows maths: `-x^2` is `-(x^2)`, `^` is right-associative,
 *  implicit multiplication `2x` and `2(x+1)` works. Throws a readable Error when the text does not parse (validateScene reports it). */
type Ast = (x: number) => number
const MATH: Record<string, (n: number) => number> = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, sqrt: Math.sqrt, abs: Math.abs }
export function makeFn(src: string): (x: number) => number {
  const s = src.replace(/\s+/g, '')
  let i = 0
  const fail = (m: string): never => { throw new Error(`${m} at position ${i} in "${src}"`) }
  const peek = () => s[i]
  const primary = (): Ast => {
    const c = peek()
    if (c === '(') { i++; const v = add(); if (peek() !== ')') fail('missing )'); i++; return v }
    const num = s.slice(i).match(/^(\d+\.?\d*|\.\d+)/)
    if (num) { i += num[0].length; const v = parseFloat(num[0]); return () => v }
    const id = s.slice(i).match(/^[a-z]+/)
    if (id) {
      const w = id[0]
      // longest known name first so "exp" is not read as "e" then "xp"
      for (const name of ['sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs', 'pi', 'x', 'e']) {
        if (!w.startsWith(name)) continue
        i += name.length
        if (name === 'x') return (x) => x
        if (name === 'pi') return () => Math.PI
        if (name === 'e') return () => Math.E
        if (peek() !== '(') fail(`${name} needs ( )`)
        i++; const inner = add(); if (peek() !== ')') fail('missing )'); i++
        const f = MATH[name]; return (x) => f(inner(x))
      }
      fail(`unknown name "${w}"`)
    }
    return fail(c === undefined ? 'unexpected end' : `unexpected "${c}"`)
  }
  // ^ binds tighter than unary minus on its left (-x^2 = -(x^2)) but a unary minus may follow it (2^-1)
  const power = (): Ast => { const b = primary(); if (peek() === '^') { i++; const e = unary(); return (x) => Math.pow(b(x), e(x)) } return b }
  const unary = (): Ast => { if (peek() === '-') { i++; const v = unary(); return (x) => -v(x) } if (peek() === '+') { i++; return unary() } return power() }
  const mul = (): Ast => {
    let v = unary()
    for (;;) {
      const c = peek()
      if (c === '*') { i++; const l = v, r = unary(); v = (x) => l(x) * r(x) }
      else if (c === '/') { i++; const l = v, r = unary(); v = (x) => l(x) / r(x) }
      else if (c === '(' || (c !== undefined && /[a-z0-9.]/.test(c))) { const l = v, r = power(); v = (x) => l(x) * r(x) } // implicit multiplication
      else break
    }
    return v
  }
  function add(): Ast {
    let v = mul()
    for (;;) {
      const c = peek()
      if (c === '+') { i++; const l = v, r = mul(); v = (x) => l(x) + r(x) }
      else if (c === '-') { i++; const l = v, r = mul(); v = (x) => l(x) - r(x) }
      else break
    }
    return v
  }
  if (!s) fail('empty expression')
  const ast = add()
  if (i < s.length) fail(`unexpected "${s[i]}"`)
  return ast
}

export interface TreeLayout { nodes: { id?: string; label: string; x: number; y: number }[]; edges: [number, number][]; w: number; h: number }
export function layoutTree(root: TreeNode, dx = 44, dy = 56): TreeLayout {
  const nodes: TreeLayout['nodes'] = [], edges: [number, number][] = []
  let leaf = 0, maxD = 0
  const go = (t: TreeNode, d: number): number => {
    maxD = Math.max(maxD, d)
    const kids = (t.children ?? []).map((c) => go(c, d + 1))
    const idx = nodes.length
    nodes.push({ id: t.id, label: t.label, x: 0, y: d * dy })
    const x = kids.length ? (nodes[kids[0]].x + nodes[kids[kids.length - 1]].x) / 2 : leaf++ * dx
    nodes[idx].x = x
    kids.forEach((k) => edges.push([idx, k]))
    return idx
  }
  go(root, 0)
  return { nodes, edges, w: Math.max(0, leaf - 1) * dx, h: maxD * dy }
}
