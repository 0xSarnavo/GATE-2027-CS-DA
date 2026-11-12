// @ts-nocheck  (bun test file; web tsconfig has no bun/node types)
import { expect, test } from 'bun:test'
import { Objects } from './render'

const nodes = (v: any): any[] => {
  if (Array.isArray(v)) return v.flatMap(nodes)
  if (!v || typeof v !== 'object') return []
  return [v, ...nodes(typeof v.type === 'function' ? v.type(v.props) : v.props?.children)]
}
const render = (objects: any[], viewBox?: [number, number, number, number], draw = 1) => {
  const c: any = {
    scene: { objects, viewBox }, objs: Object.fromEntries(objects.map((o) => [o.id, o])),
    st: { props: {}, dim: {}, hl: {} }, fr: { vis: {}, num: {}, draw: { cv: draw } },
    e: 1, fs: (n: number) => n, katex: null,
  }
  return nodes(Objects({ c }))
}

test('sampled curve stays visible above a hidden y axis', () => {
  const ns = render([
    { id: 'ax', kind: 'axis', x: 180, y: 150, unit: 40, xr: [-3, 3], yr: [0, 0] },
    { id: 'cv', kind: 'curve', axis: 'ax', fn: 'exp(-x^2/2)' },
  ])
  const path = ns.find((n) => n.type === 'path')
  expect(path.props.d).toContain('L180.0,110.0')
  expect(path.props.d.match(/M/g)).toHaveLength(1)
})

test('discarded samples split a curve without breaking path draw progress', () => {
  const ns = render([
    { id: 'ax', kind: 'axis', x: 180, y: 120, unit: 40, xr: [-3, 3], yr: [-3, 3] },
    { id: 'cv', kind: 'curve', axis: 'ax', fn: '1/x' },
  ], undefined, 0.5)
  const path = ns.find((n) => n.type === 'path')
  expect(path.props.d.match(/M/g)).toHaveLength(2)
  expect(path.props.pathLength).toBe(1)
  expect(path.props['stroke-dasharray']).toBe('0.5 1')
})

test('small axis units thin labels and gridlines by their own steps', () => {
  const ns = render([{ id: 'ax', kind: 'axis', x: 20, y: 120, unit: 8, xr: [0, 40], yr: [-10, 10] }])
  const labels = ns.filter((n) => n.type === 'text')
  expect(labels.filter((n) => n.props['text-anchor'] === 'middle').map((n) => n.props.children)).toEqual([5, 10, 15, 20, 25, 30, 35, 40])
  expect(labels.filter((n) => n.props['text-anchor'] === 'end').map((n) => n.props.children)).toEqual([-10, -8, -6, -4, -2, 2, 4, 6, 8, 10])
  const grid = ns.filter((n) => n.type === 'line' && n.props.class === 'agrid')
  expect(grid.filter((n) => n.props.x1 === n.props.x2)).toHaveLength(8)
  expect(grid.filter((n) => n.props.y1 === n.props.y2)).toHaveLength(10)
})

test('colliding axis tick labels keep the y label and the x grid line', () => {
  const ns = render([{ id: 'ax', kind: 'axis', x: 170, y: 205, unit: 22, xr: [-1, 2], yr: [-1, 2] }])
  const labels = ns.filter((n) => n.type === 'text')
  expect(labels.filter((n) => n.props['text-anchor'] === 'middle').map((n) => n.props.children)).toEqual([1, 2])
  expect(labels.filter((n) => n.props['text-anchor'] === 'end').map((n) => n.props.children)).toEqual([-1, 1, 2])
  expect(ns.filter((n) => n.type === 'line' && n.props.class === 'agrid' && n.props.x1 === 148 && n.props.x2 === 148)).toHaveLength(1)
})

test('separated axis tick labels all remain visible', () => {
  const ns = render([{ id: 'ax', kind: 'axis', x: 170, y: 205, unit: 40, xr: [-1, 2], yr: [-1, 2] }])
  const labels = ns.filter((n) => n.type === 'text')
  expect(labels.filter((n) => n.props['text-anchor'] === 'middle').map((n) => n.props.children)).toEqual([-1, 1, 2])
  expect(labels.filter((n) => n.props['text-anchor'] === 'end').map((n) => n.props.children)).toEqual([-1, 1, 2])
})

test('bar hideZero removes only zero value labels', () => {
  const bar = { id: 'b', kind: 'bar', x: 10, y: 10, values: [0, 2, 0], labels: ['A', 'B', 'C'] }
  const labels = (hideZero?: boolean) => render([{ ...bar, hideZero }]).filter((n) => n.type === 'text').map((n) => n.props.children)
  expect(labels()).toEqual([0, 'A', 2, 'B', 0, 'C'])
  expect(labels(true)).toEqual(['A', 2, 'B', 'C'])
  expect(render([{ ...bar, hideZero: true }]).filter((n) => n.type === 'rect')).toHaveLength(3)
})

test('axis names move inside the viewBox at its right and top edges', () => {
  const ns = render([{ id: 'ax', kind: 'axis', x: 40, y: 120, unit: 40, xr: [0, 4], yr: [0, 3], xlabel: 'time', ylabel: 'value' }], [0, 0, 205, 240])
  const labels = ns.filter((n) => n.type === 'text')
  const x = labels.find((n) => n.props.children === 'time'), y = labels.find((n) => n.props.children === 'value')
  expect([x.props.x, x.props.y, x.props['text-anchor']]).toEqual([204, 108, 'end'])
  expect([y.props.x, y.props.y]).toEqual([48, 13])
  const edge = render([{ id: 'ax', kind: 'axis', x: 40, y: 120, unit: 40, xr: [0, 4], yr: [0, 3], xlabel: 'time' }], [0, 0, 200, 240])
  expect(edge.find((n) => n.type === 'text' && n.props.children === 'time').props.x).toBe(200)
})
