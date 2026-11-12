import { today } from './util'

/** The ids the question screen steps through. A plain queue has no summary; a "session" (path node, Continue Lx) tracks results
 *  so the session summary can show accuracy, time, XP and mistakes. */
export interface SessResult { correct: boolean; timeS: number; hint: boolean; label: string }
export interface Sess { ids: string[]; label: string; back: string; t0: number; results: Record<string, SessResult> }
let q: string[] = []
let sess: Sess | null = null
export const setQueue = (ids: string[]) => { q = ids; sess = null }
export const startSession = (ids: string[], label: string, back: string) => { q = ids; sess = { ids, label, back, t0: Date.now(), results: {} } }
export const getSession = () => sess
export const inSession = (id: string) => !!sess && sess.ids.includes(id)
export const nextAfter = (id: string): string | undefined => { const i = q.indexOf(id); return i >= 0 ? q[i + 1] : undefined }
export const queuePos = (id: string): [number, number] | null => { const i = q.indexOf(id); return i >= 0 ? [i + 1, q.length] : null }

// ---- XP (per device, per day): 10 per correct answer, +5 when no hint was used, 2 for a wrong attempt ----
const XK = 'gate.xp'
export const xpFor = (r: { correct: boolean; hint: boolean }) => (r.correct ? 10 + (r.hint ? 0 : 5) : 2)
export function xpToday(): number {
  try { const v = JSON.parse(localStorage.getItem(XK) || '{}'); return v.date === today() ? +v.xp || 0 : 0 } catch { return 0 }
}
export function addXp(n: number) {
  try { localStorage.setItem(XK, JSON.stringify({ date: today(), xp: xpToday() + n })) } catch { /* private mode */ }
  xpSubs.forEach((f) => f())
}
const xpSubs = new Set<() => void>()
export const onXp = (f: () => void) => { xpSubs.add(f); return () => { xpSubs.delete(f) } }
export function recordResult(id: string, r: SessResult) {
  if (sess) sess.results[id] = r
  addXp(xpFor(r))
}
