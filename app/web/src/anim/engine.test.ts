// @ts-nocheck  (bun test file; web tsconfig has no bun/node types)
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { stateAt, makeFn, mixFrame } from './engine'
import { validateScene } from './validate'

const scene = (steps: any[], cells = [1, 2, 3]) => ({
  id: 's', title: 'T',
  objects: [{ id: 'st', kind: 'array', cells }, { id: 'b', kind: 'box', x: 0, y: 0, w: 10, h: 10 }],
  steps: steps.map((s) => ({ caption: 'c', ...s })),
})

test('pop, pop, push in one step applies pops before the push', () => {
  const sc = scene([{ pop: [{ id: 'st' }, { id: 'st' }], push: { id: 'st', value: 5 } }])
  expect(validateScene(sc).ok).toBe(true)
  const s = stateAt(sc, 0)
  expect(s.props.st.cells).toEqual([1, 5])
  expect(s.popped.map((p) => p.value)).toEqual([3, 2])
})
test('set copies, and stateAt never mutates the scene', () => {
  const src = [7, 8]
  const sc = scene([{ set: { id: 'st', cells: src } }, { push: { id: 'st', value: 9 } }, { pop: [{ id: 'st' }, { id: 'st' }] }])
  const before = JSON.stringify(sc)
  for (let r = 0; r < 2; r++) {
    expect(stateAt(sc, 1).props.st.cells).toEqual([7, 8, 9])
    expect(stateAt(sc, 2).props.st.cells).toEqual([7])
  }
  expect(src).toEqual([7, 8])
  expect(JSON.stringify(sc)).toBe(before)
})
test('dim / undim work on whole non-cell objects', () => {
  const sc = scene([{ dim: 'b' }, { undim: 'b' }])
  expect(stateAt(sc, 0).dim.b).toBe('all')
  expect(stateAt(sc, 1).dim.b).toBeUndefined()
})
test('render keeps text spaces and dims whole objects', async () => {
  const src = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8')
  expect(src).toContain("'xml:space': 'preserve'")
  expect(src).toContain("whiteSpace: 'pre'")
  expect(src).toContain('CELLED.has(o.kind) ? 0.35')
})
test('all authored explainers validate', () => {
  const dir = new URL('../../../data/explainers/', import.meta.url)
  const bad: any[] = []
  const walk = (u: URL) => { for (const e of readdirSync(u, { withFileTypes: true })) {
    if (e.isDirectory()) walk(new URL(e.name + '/', u))
    else if (e.name.endsWith('.json')) { const j = JSON.parse(readFileSync(new URL(e.name, u), 'utf8')); for (const s of j.scenes ?? (j.objects ? [j] : [])) { const r = validateScene(s); if (!r.ok) bad.push({ f: e.name, errors: r.errors }) } }
  } }
  walk(dir)
  expect(bad).toEqual([])
})

test('curve fn: unary minus before a power compiles and follows maths precedence', () => {
  expect(makeFn('exp(-x^2/2)')(0)).toBeCloseTo(1)
  expect(makeFn('exp(-x^2/2)')(2)).toBeCloseTo(Math.exp(-2))
  expect(makeFn('-x^2')(3)).toBe(-9)
  expect(makeFn('2^-1')(0)).toBe(0.5)
  expect(makeFn('2^3^2')(0)).toBe(512)
  expect(makeFn('2x+1')(4)).toBe(9)
  expect(makeFn('sin(pi*x)')(0.5)).toBeCloseTo(1)
  expect(makeFn('sqrt(abs(x))+e')(4)).toBeCloseTo(2 + Math.E)
  expect(() => makeFn('x+*2')).toThrow(); expect(() => makeFn('sin x')).toThrow(); expect(() => makeFn('(x')).toThrow()
})

test('arc move follows the circle in either direction instead of its chord', () => {
  const a = { vis: { p: 1 }, num: { p: { x: 1, y: 0 } }, draw: { p: 1 } }
  const b = { vis: { p: 1 }, num: { p: { x: 0, y: 1 } }, draw: { p: 1 } }
  const arc = { p: { cx: 0, cy: 0 } }
  const mid = mixFrame(a, b, new Set(), 0.5, arc).num.p
  expect(mid.x).toBeCloseTo(Math.SQRT1_2)
  expect(mid.y).toBeCloseTo(Math.SQRT1_2)
  expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(1)
  const reverse = mixFrame(b, a, new Set(), 0.5, arc).num.p
  expect(reverse.x).toBeCloseTo(mid.x)
  expect(reverse.y).toBeCloseTo(mid.y)
  expect(mixFrame(a, b, new Set(), 0.5).num.p).toEqual({ x: 0.5, y: 0.5 })
})
