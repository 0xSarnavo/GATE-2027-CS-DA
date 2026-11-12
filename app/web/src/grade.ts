import type { Q } from './types'

export const sortedKeys = (s: string) => s.split(/[,\s]+/).filter(Boolean).map((x) => x.toUpperCase()).sort().join(',')

/** Local grading (mirrors server rules): MCQ exact, MSQ exact set, NAT within range (alternatives separated by |). */
export function gradeLocal(q: Q, given: string): boolean {
  if (q.answer.toUpperCase() === 'MTA') return true
  if (q.type === 'NAT') {
    const v = Number(given.replace(/,/g, '')); if (!given.trim() || !Number.isFinite(v)) return false
    return q.answer.split('|').some((part) => {
      const m = part.trim().match(/^(-?[\d.eE+-]+)\s*\.\.\s*(-?[\d.eE+-]+)$/)
      if (m) { const lo = Number(m[1]), hi = Number(m[2]); return v >= Math.min(lo, hi) - 1e-9 && v <= Math.max(lo, hi) + 1e-9 }
      const key = Number(part.trim())
      return Number.isFinite(key) && Math.abs(v - key) <= Math.max(1e-6, Math.abs(key) * 1e-3)
    })
  }
  return q.answer.split('|').some((alt) => sortedKeys(given) === sortedKeys(alt))
}
/** Every option key that appears in some accepted alternative. */
export const answerKeys = (q: Q) => new Set(q.answer.split('|').flatMap((a) => a.split(',').map((x) => x.trim())))
export function prettyAnswer(q: Q): string {
  if (q.type === 'NAT') return q.answer.split('|').map((p) => p.replace('..', ' to ')).join(' or ')
  if (q.answer.toUpperCase() === 'MTA') return 'MTA (marks to all)'
  return q.answer.split('|').map((a) => a.split(',').join(', ')).join(' or ')
}

/** SM-2 preview for the interval labels on grade buttons. */
export function sm2Next(ease = 2.5, interval = 0, reps = 0, grade: number) {
  if (grade < 3) return { interval: 1, ease, reps: 0 }
  const e = Math.max(1.3, ease + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
  const i = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(interval * e)
  return { interval: i, ease: e, reps: reps + 1 }
}
export const ivLabel = (d: number) => (d < 1 ? '<1d' : d < 30 ? `${d}d` : d < 365 ? `${Math.round(d / 30)}mo` : `${(d / 365).toFixed(1)}y`)
