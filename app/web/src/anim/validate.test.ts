// @ts-nocheck  (bun test file; web tsconfig has no bun/node types)
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { validateScene } from './validate'

const dir = new URL('../../../data/explainers/_samples/', import.meta.url)
const base = () => ({
  id: 's', title: 'T',
  objects: [{ id: 'a', kind: 'node', x: 1, y: 1, label: 'A' }, { id: 'b', kind: 'node', x: 5, y: 5 }, { id: 'e', kind: 'edge', from: 'a', to: 'b' }, { id: 'arr', kind: 'array', cells: [1, 2] }],
  steps: [{ caption: 'one', show: 'a' }],
})

test('every sample scene validates, including those inside explainers', () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
    for (const s of j.scenes ?? [j]) { const r = validateScene(s); expect({ f, errors: r.errors }).toEqual({ f, errors: [] }) }
  }
})
test('accepts a minimal scene with single items instead of arrays', () => expect(validateScene(base()).ok).toBe(true))
test('bar hideZero accepts booleans only', () => {
  const s: any = base()
  s.objects.push({ id: 'bars', kind: 'bar', values: [0, 1], hideZero: true })
  expect(validateScene(s).errors).toEqual([])
  s.objects[4].hideZero = false
  expect(validateScene(s).errors).toEqual([])
  s.objects[4].hideZero = 'yes'
  expect(validateScene(s).errors.join('\n')).toContain('hideZero: must be a boolean')
})
test('rejects missing / duplicate / spaced ids', () => {
  const s: any = base(); s.objects.push({ kind: 'node' }, { id: 'a', kind: 'node' }, { id: 'x y', kind: 'node' })
  const e = validateScene(s).errors.join('\n')
  expect(e).toContain('missing "id"'); expect(e).toContain('duplicate id "a"'); expect(e).toContain('must not contain spaces')
})
test('unknown ids get a suggestion', () => {
  const s: any = base(); s.steps[0].highlight = ['arrr']
  expect(validateScene(s).errors[0]).toContain('did you mean "arr"')
})
test('unknown kind, unknown op, bad refs, bad curve fn', () => {
  const s: any = base()
  s.objects.push({ id: 'z', kind: 'blob' }, { id: 'v', kind: 'vector', axis: 'a', to: [1, 1] }, { id: 'c', kind: 'curve', axis: 'a', fn: 'process.exit()' })
  s.steps[0].teleport = 1; s.steps[0].push = { id: 'a', value: 1 }
  const e = validateScene(s).errors.join('\n')
  for (const m of ['unknown kind "blob"', 'unknown field "teleport"', '"a" is a node, but a axis', 'fn: use only', 'but a array is needed']) expect(e).toContain(m)
})
test('requires caption, steps and objects', () => {
  expect(validateScene({ id: 'x', objects: [], steps: [] }).ok).toBe(false)
  const s: any = base(); s.steps = [{ show: ['a'] }]
  expect(validateScene(s).errors[0]).toContain('caption')
  expect(validateScene(null).ok).toBe(false)
})

test('validateScene reports a curve fn that does not compile, and accepts exp(-x^2/2)', () => {
  const mk = (fn: string) => ({ id: 'c', title: 'T', objects: [{ id: 'ax', kind: 'axis', x: 0, y: 0 }, { id: 'cv', kind: 'curve', axis: 'ax', fn }], steps: [{ caption: 'c', show: 'cv' }] })
  expect(validateScene(mk('exp(-x^2/2)')).errors).toEqual([])
  expect(validateScene(mk('x+*2')).errors.join('\n')).toContain('does not compile')
  expect(validateScene(mk('x^(')).ok).toBe(false)
})

test('new point, strip, circle and arc options validate together', () => {
  const s: any = {
    id: 'new', title: 'Limits and sets',
    objects: [
      { id: 'ax', kind: 'axis' },
      { id: 'hole', kind: 'point', axis: 'ax', at: [1, 0], hollow: true },
      { id: 'strip', kind: 'box', x: 2, y: 2, w: 2, h: 60, square: true },
      { id: 'set', kind: 'circle', cx: 100, cy: 100, r: 45, tone: 'accent', fillOpacity: 0.25 },
    ],
    steps: [{ caption: 'A circular path', move: { id: 'hole', x: 0, y: 1, arc: { cx: 0, cy: 0 } } }],
  }
  expect(validateScene(s).errors).toEqual([])
  s.steps[0].move.arc = { cx: 0, cy: 2 }
  expect(validateScene(s).errors.join('\n')).toContain('same circle')
  s.steps[0].move.id = 'strip'
  expect(validateScene(s).errors.join('\n')).toContain('only points')
  s.objects[3].fillOpacity = 2
  expect(validateScene(s).errors.join('\n')).toContain('fillOpacity')
})
