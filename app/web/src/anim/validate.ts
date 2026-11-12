import type { Scene } from './types'
import { makeFn } from './engine'

export const KINDS = ['node', 'edge', 'arrow', 'box', 'circle', 'text', 'math', 'array', 'matrix', 'grid', 'bar', 'axis', 'point', 'vector', 'curve', 'tree', 'pointer'] as const
export const TONES = ['accent', 'good', 'bad', 'mid', 'muted']
const OPS = ['caption', 'math', 'show', 'hide', 'highlight', 'dim', 'undim', 'move', 'set', 'draw', 'animate', 'swap', 'push', 'pop']
const arr = <T,>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x])
const isNum = (n: unknown) => typeof n === 'number' && isFinite(n)
const isObj = (o: unknown): o is Record<string, any> => !!o && typeof o === 'object' && !Array.isArray(o)

function dist(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const hint = (id: string, ids: string[]) => {
  const best = ids.map((x) => [x, dist(id, x)] as const).sort((a, b) => a[1] - b[1])[0]
  return best && best[1] <= Math.max(2, id.length / 3) ? ` (did you mean "${best[0]}"?)` : ids.length ? ` (known ids: ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? ', ...' : ''})` : ''
}
/** Allowed characters in curve `fn` expressions: numbers, x, operators and a few math names. */
export const FN_OK = /^(?:[0-9.\s+\-*/^(),x]|sin|cos|tan|exp|log|sqrt|abs|pi|e)+$/

export interface ValidationResult { ok: boolean; errors: string[]; warnings: string[] }

/** Forgiving about shapes (single item instead of array, missing viewBox/title), strict about ids and references. */
export function validateScene(input: unknown): ValidationResult {
  const errors: string[] = [], warnings: string[] = []
  const err = (m: string) => errors.push(m)
  if (!isObj(input)) return { ok: false, errors: ['scene must be a JSON object'], warnings }
  const s = input as Record<string, any>
  if (typeof s.id !== 'string' || !s.id) err('scene.id: required non-empty string')
  if (s.title != null && typeof s.title !== 'string') err('scene.title: must be a string')
  else if (!s.title) warnings.push('scene.title: missing (used as the accessible name)')
  if (s.viewBox != null && !(Array.isArray(s.viewBox) && s.viewBox.length === 4 && s.viewBox.every(isNum) && s.viewBox[2] > 0 && s.viewBox[3] > 0))
    err('scene.viewBox: must be [minX, minY, width, height] with positive width/height')
  if (!Array.isArray(s.objects)) err('scene.objects: must be an array')
  if (!Array.isArray(s.steps) || !s.steps.length) err('scene.steps: must be a non-empty array')
  if (errors.length && (!Array.isArray(s.objects) || !Array.isArray(s.steps))) return { ok: false, errors, warnings }

  const kinds: Record<string, string> = {}
  const treeIds = new Set<string>()
  const dupe = (id: string, where: string) => (id in kinds ? (err(`${where}: duplicate id "${id}"`), true) : false)
  s.objects.forEach((o: any, i: number) => {
    const w = `objects[${i}]`
    if (!isObj(o)) return err(`${w}: must be an object`)
    if (typeof o.id !== 'string' || !o.id) return err(`${w}: missing "id" (every object needs a unique string id)`)
    if (/[\s]/.test(o.id)) err(`${w}: id "${o.id}" must not contain spaces`)
    if (!(KINDS as readonly string[]).includes(o.kind)) err(`${w} ("${o.id}"): unknown kind "${o.kind}". Use one of: ${KINDS.join(', ')}`)
    if (dupe(o.id, w)) return
    kinds[o.id] = o.kind
    if (o.tone != null && !TONES.includes(o.tone)) err(`${w} ("${o.id}"): tone "${o.tone}" must be one of ${TONES.join(', ')}`)
    if (o.kind === 'tree' && isObj(o.root)) {
      const walk = (t: any, p: string) => {
        if (!isObj(t) || typeof t.label !== 'string') return err(`${w}.${p}: tree node needs a string "label"`)
        if (t.id != null) { if (dupe(String(t.id), `${w}.${p}.id`)) return; kinds[t.id] = 'treenode'; treeIds.add(t.id) }
        arr(t.children).forEach((c, k) => walk(c, `${p}.children[${k}]`))
      }
      walk(o.root, 'root')
    }
  })
  const ids = Object.keys(kinds)
  const need = (o: any, i: number, f: string, test: (v: any) => boolean, what: string) => {
    if (!test(o[f])) err(`objects[${i}] ("${o.id}", ${o.kind}): "${f}" must be ${what}`)
  }
  const ref = (where: string, id: unknown, ok?: string[]) => {
    if (typeof id !== 'string') return err(`${where}: expected an object id string`), false
    if (!(id in kinds)) return err(`${where}: unknown id "${id}"${hint(id, ids)}`), false
    if (ok && !ok.includes(kinds[id])) return err(`${where}: "${id}" is a ${kinds[id]}, but a ${ok.join('/')} is needed here`), false
    return true
  }
  const pair = (v: any) => Array.isArray(v) && v.length === 2 && v.every(isNum)
  s.objects.forEach((o: any, i: number) => {
    if (!isObj(o) || typeof o.id !== 'string') return
    const w = `objects[${i}] ("${o.id}")`
    for (const f of ['x', 'y', 'w', 'h', 'r', 'cw', 'ch', 'size', 'unit', 'dx', 'dy']) if (o[f] != null && !isNum(o[f])) err(`${w}: "${f}" must be a number`)
    switch (o.kind) {
      case 'edge': case 'arrow':
        if (o.from != null || o.to != null) { ref(`${w}.from`, o.from); ref(`${w}.to`, o.to) }
        else if (!['x1', 'y1', 'x2', 'y2'].every((f) => isNum(o[f]))) err(`${w}: needs "from" and "to" object ids, or x1,y1,x2,y2 numbers`)
        break
      case 'box':
        need(o, i, 'w', isNum, 'a number'); need(o, i, 'h', isNum, 'a number')
        if (o.square != null && typeof o.square !== 'boolean') err(`${w}.square: must be a boolean`)
        break
      case 'circle':
        need(o, i, 'cx', isNum, 'a number'); need(o, i, 'cy', isNum, 'a number')
        if (!isNum(o.r) || o.r <= 0) err(`${w}.r: must be a positive number`)
        if (o.fillOpacity != null && (!isNum(o.fillOpacity) || o.fillOpacity < 0 || o.fillOpacity > 1)) err(`${w}.fillOpacity: must be from 0 to 1`)
        break
      case 'text': need(o, i, 'text', (v) => typeof v === 'string', 'a string'); break
      case 'math': need(o, i, 'tex', (v) => typeof v === 'string', 'a TeX string (no $ delimiters)'); break
      case 'array': need(o, i, 'cells', Array.isArray, 'an array (can be empty for stacks/queues)'); break
      case 'matrix': need(o, i, 'values', (v) => Array.isArray(v) && v.every(Array.isArray), 'an array of rows'); break
      case 'grid': need(o, i, 'rows', Number.isInteger, 'an integer'); need(o, i, 'cols', Number.isInteger, 'an integer'); break
      case 'bar':
        need(o, i, 'values', (v) => Array.isArray(v) && v.every(isNum), 'an array of numbers')
        if (o.hideZero != null && typeof o.hideZero !== 'boolean') err(`${w}.hideZero: must be a boolean`)
        break
      case 'point':
        ref(`${w}.axis`, o.axis, ['axis']); need(o, i, 'at', pair, '[x, y]')
        if (o.hollow != null && typeof o.hollow !== 'boolean') err(`${w}.hollow: must be a boolean`)
        break
      case 'vector': ref(`${w}.axis`, o.axis, ['axis']); need(o, i, 'to', pair, '[x, y]'); if (o.from != null) need(o, i, 'from', pair, '[x, y]'); break
      case 'curve':
        ref(`${w}.axis`, o.axis, ['axis'])
        if (o.fn != null) { if (typeof o.fn !== 'string' || !FN_OK.test(o.fn)) err(`${w}.fn: use only x, numbers, + - * / ^ ( ) and sin cos tan exp log sqrt abs pi e`)
          else { try { const f = makeFn(o.fn); const y = f(0.5); if (typeof y !== 'number') err(`${w}.fn: does not evaluate to a number`) } catch (e: any) { err(`${w}.fn does not compile: ${e.message}`) } } }
        else if (!Array.isArray(o.points) || !o.points.every(pair)) err(`${w}: needs "fn" (e.g. "x^2") or "points" [[x,y],...]`)
        break
      case 'tree': need(o, i, 'root', isObj, 'an object {label, children?}'); break
      case 'pointer': ref(`${w}.array`, o.array, ['array']); need(o, i, 'index', isNum, 'a number'); break
    }
    if (o.kind === 'array' && o.dir != null && !['right', 'up', 'down'].includes(o.dir)) err(`${w}: dir must be right, up or down`)
  })

  const tonesOk = (w: string, t: unknown) => { if (t != null && !TONES.includes(t as string)) err(`${w}: tone must be one of ${TONES.join(', ')}`) }
  const pointPositions = new Map<string, [number, number]>(s.objects.filter((o: any) => o?.kind === 'point' && pair(o.at)).map((o: any) => [o.id, o.at]))
  const idList = (w: string, v: unknown) => arr(v as any).forEach((id, k) => ref(`${w}[${k}]`, id))
  s.steps.forEach((st: any, i: number) => {
    const w = `steps[${i}]`
    if (!isObj(st)) return err(`${w}: must be an object`)
    if (typeof st.caption !== 'string' || !st.caption.trim()) err(`${w}.caption: required (say what to notice)`)
    if (st.math != null && typeof st.math !== 'string') err(`${w}.math: must be a string like "$a^2$"`)
    for (const k of Object.keys(st)) if (!OPS.includes(k)) err(`${w}: unknown field "${k}". Known: ${OPS.join(', ')}`)
    idList(`${w}.show`, st.show); idList(`${w}.hide`, st.hide); idList(`${w}.draw`, st.draw); idList(`${w}.undim`, st.undim)
    arr(st.highlight).forEach((h: any, k: number) => {
      const hw = `${w}.highlight[${k}]`
      if (typeof h === 'string') return void ref(hw, h)
      if (!isObj(h)) return err(`${hw}: expected an id string or {id, cells?, tone?}`)
      ref(hw + '.id', h.id); tonesOk(hw, h.tone)
      if (h.cells != null && !Array.isArray(h.cells)) err(`${hw}.cells: must be an array of indices`)
    })
    arr(st.dim).forEach((d: any, k: number) => (typeof d === 'string' ? ref(`${w}.dim[${k}]`, d) : isObj(d) ? ref(`${w}.dim[${k}].id`, d.id) : err(`${w}.dim[${k}]: expected id or {id, cells}`)))
    arr(st.animate).forEach((a: any, k: number) => { if (!isObj(a)) return err(`${w}.animate[${k}]: expected {id, prop:"draw"}`); ref(`${w}.animate[${k}].id`, a.id); if (a.prop !== 'draw') err(`${w}.animate[${k}].prop: only "draw" is supported`) })
    arr(st.move).forEach((m: any, k: number) => {
      const mw = `${w}.move[${k}]`
      if (!isObj(m) || !ref(mw + '.id', m.id)) return
      const kd = kinds[m.id]
      if (kd === 'pointer') { if (!isNum(m.index)) err(`${mw}: moving a pointer needs a numeric "index"`) }
      else if ((!isNum(m.x) && !isNum(m.y)) || (m.x !== undefined && !isNum(m.x)) || (m.y !== undefined && !isNum(m.y))) err(`${mw}: needs numeric x or y${kd === 'vector' || kd === 'point' ? ' (axis units)' : ''}`)
      if (m.arc != null) {
        if (kd !== 'point') err(`${mw}.arc: only points can follow an arc`)
        else if (!isObj(m.arc) || !isNum(m.arc.cx) || !isNum(m.arc.cy) || !isNum(m.x) || !isNum(m.y)) err(`${mw}.arc: needs numeric cx, cy, x and y`)
        else {
          const p = pointPositions.get(m.id)
          if (p) {
            const r0 = Math.hypot(p[0] - m.arc.cx, p[1] - m.arc.cy), r1 = Math.hypot(m.x - m.arc.cx, m.y - m.arc.cy)
            if (r0 <= 0 || Math.abs(r0 - r1) > 1e-4 * Math.max(1, r0, r1)) err(`${mw}.arc: start and end must lie on the same circle`)
          }
        }
      }
      if (kd === 'point' && pointPositions.has(m.id)) {
        const p = pointPositions.get(m.id)!
        pointPositions.set(m.id, [isNum(m.x) ? m.x : p[0], isNum(m.y) ? m.y : p[1]])
      }
    })
    arr(st.set).forEach((o: any, k: number) => { const sw = `${w}.set[${k}]`; if (isObj(o) && ref(sw + '.id', o.id)) tonesOk(sw, o.tone); else if (!isObj(o)) err(`${sw}: expected {id, ...}`) })
    arr(st.swap).forEach((o: any, k: number) => {
      const sw = `${w}.swap[${k}]`
      if (isObj(o) && ref(sw + '.id', o.id, ['array'])) {
        const n = (s.objects.find((x: any) => x.id === o.id)?.cells ?? []).length
        if (!Number.isInteger(o.i) || !Number.isInteger(o.j)) err(`${sw}: needs integer i and j`)
        else if (n && (o.i < 0 || o.j < 0 || o.i >= n || o.j >= n)) warnings.push(`${sw}: i/j outside the initial ${n} cells (fine if pushes happened earlier)`)
      } else if (!isObj(o)) err(`${sw}: expected {id, i, j}`)
    })
    arr(st.push).forEach((o: any, k: number) => { const pw = `${w}.push[${k}]`; if (isObj(o)) { ref(pw + '.id', o.id, ['array']); if (o.value == null) err(`${pw}: missing "value"`) } else err(`${pw}: expected {id, value}`) })
    arr(st.pop).forEach((o: any, k: number) => { const pw = `${w}.pop[${k}]`; if (isObj(o)) { ref(pw + '.id', o.id, ['array']); if (o.end != null && !['back', 'front'].includes(o.end)) err(`${pw}.end: back (stack) or front (queue)`) } else err(`${pw}: expected {id}`) })
  })
  return { ok: !errors.length, errors, warnings }
}

export function assertScene(s: unknown): Scene {
  const r = validateScene(s)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return s as Scene
}
