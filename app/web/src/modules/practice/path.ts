import type { Q } from '../../types'

/** Easy to hard: recent papers first, then by difficulty, then the author's order. */
export const byEase = (a: Q, b: Q) => Number(a.pre2017) - Number(b.pre2017) || a.difficulty - b.difficulty || (a.order_in_topic ?? 999) - (b.order_in_topic ?? 999) || (b.year ?? 0) - (a.year ?? 0) || Number(a.q_no) - Number(b.q_no)

export const LEVELS = ['Concept check', 'Single-step apply', 'Two-step / combine', 'GATE 2-mark', 'Tricky / hardest']

export type NodeState = 'locked' | 'avail' | 'current' | 'done' | 'crown'
export interface PNode {
  key: string; kind: 'level' | 'pyq' | 'crown'; level?: number; title: string; sub: string
  ids: string[]; done: number; total: number; state: NodeState
}

/** The learning path for a set of questions: L1-L5 nodes (ladder questions of that level), then past-paper nodes easy to hard, then a crown. */
export function buildPath(inScope: Q[], solved: (q: Q) => boolean): PNode[] {
  const gen = inScope.filter((q) => q.source !== 'official')
  const pyqs = [...inScope.filter((q) => q.source === 'official')].sort(byEase)
  const nodes: PNode[] = [1, 2, 3, 4, 5].map((l) => {
    const qs = gen.filter((q) => (q.level ?? 3) === l).sort(byEase)
    const done = qs.filter(solved).length
    return { key: 'L' + l, kind: 'level' as const, level: l, title: LEVELS[l - 1], sub: qs.length ? `${done}/${qs.length}` : 'No questions yet', ids: qs.map((q) => q.id), done, total: qs.length, state: 'avail' as NodeState }
  })
  const per = Math.max(8, Math.ceil(pyqs.length / 8))
  for (let i = 0; i * per < pyqs.length; i++) {
    const qs = pyqs.slice(i * per, (i + 1) * per)
    const avg = qs.reduce((n, q) => n + q.difficulty, 0) / qs.length
    const done = qs.filter(solved).length
    nodes.push({ key: 'P' + (i + 1), kind: 'pyq', title: `Past papers ${i + 1}`, sub: `${avg < 2.4 ? 'Easier' : avg < 3.4 ? 'Medium' : 'Harder'} · ${done}/${qs.length}`, ids: qs.map((q) => q.id), done, total: qs.length, state: 'avail' })
  }
  let cur = false
  for (const n of nodes) {
    if (!n.total) n.state = 'locked'
    else if (n.done >= n.total) n.state = 'done'
    else if (!cur) { n.state = 'current'; cur = true }
  }
  const real = nodes.filter((n) => n.total)
  const all = real.length > 0 && real.every((n) => n.state === 'done')
  nodes.push({ key: 'crown', kind: 'crown', title: all ? 'Chapter mastered' : 'Master every node', sub: all ? 'All questions solved' : 'Finish the path to earn the crown', ids: [], done: all ? 1 : 0, total: 1, state: all ? 'crown' : 'locked' })
  return nodes
}

/** A short session for a node: unsolved questions first, topped up with solved ones so it is never tiny. */
export function sessionIds(n: PNode, byId: Map<string, Q>, solved: (q: Q) => boolean): string[] {
  const qs = n.ids.map((i) => byId.get(i)!).filter(Boolean)
  const max = n.kind === 'level' ? 6 : 8
  const fresh = qs.filter((q) => !solved(q))
  const pick = fresh.slice(0, max)
  const min = Math.min(5, qs.length)
  if (pick.length < min) for (const q of qs) { if (pick.length >= min) break; if (!pick.includes(q)) pick.push(q) }
  return qs.filter((q) => pick.includes(q)).map((q) => q.id)
}

export const nextNode = (nodes: PNode[]) => nodes.find((n) => n.state === 'current') ?? nodes.find((n) => n.state === 'avail' && n.total) ?? nodes.find((n) => n.state === 'done')
