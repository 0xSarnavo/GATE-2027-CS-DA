import { useEffect, useRef, useState } from 'preact/hooks'
import { Nav, parentRoute, tabOf, HOME } from './nav'

export interface Route { parts: string[]; query: URLSearchParams; raw: string }
const parse = (): Route => {
  const h = location.hash.replace(/^#\/?/, '')
  const [p, q = ''] = h.split('?')
  return { parts: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q), raw: h }
}

const positions = new Map<string, number>()
const lastInTab = new Map<string, string>()
const subs = new Set<() => void>()
let last = typeof location !== 'undefined' ? parse().raw : ''
let toastFn: (m: string) => void = () => {}
export const setNavToast = (f: (m: string) => void) => { toastFn = f }
/** Topic parent lookup (subject of a chapter), filled in by Learn/Practice once topics load. */
let parentOf: (id: string) => string | null | undefined = () => null
export const setTopicParents = (f: (id: string) => string | null | undefined) => { parentOf = f }

const nav = new Nav(
  typeof history !== 'undefined' ? history : ({} as any),
  {
    raw: () => parse().raw,
    parentOf: (id) => parentOf(id),
    now: () => Date.now(),
    toast: (m) => toastFn(m),
    notify: () => {
      const next = parse().raw
      if (next !== last) {
        positions.set(last, scrollY); last = next
        const tab = tabOf(next); if (tab) lastInTab.set(tab, next)
        requestAnimationFrame(() => window.scrollTo(0, positions.get(next) ?? 0))
      }
      subs.forEach((f) => f())
    },
  },
)
if (typeof window !== 'undefined') {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  nav.init()
  lastInTab.set(tabOf(last), last)
  addEventListener('popstate', () => nav.onPop())
  addEventListener('hashchange', () => subs.forEach((f) => f()))
  for (const ev of ['pointerup', 'touchend', 'click', 'keydown'] as const) addEventListener(ev, () => nav.armGuard(), { once: true, capture: true })
}

export function useRoute(): Route {
  const [r, setR] = useState(parse())
  useEffect(() => {
    const f = () => { const n = parse(); setR((o) => (o.raw === n.raw ? o : n)) }
    subs.add(f); f(); return () => { subs.delete(f) }
  }, [])
  return r
}
export const go = (path: string, replace = false) => {
  if (/^q\//.test(path) && !/[?&]from=/.test(path)) {
    const current = parse().raw
    const origin = current.startsWith('q/') ? new URLSearchParams(current.split('?')[1] ?? '').get('from') : current
    if (origin && !origin.startsWith('q/')) path += (path.includes('?') ? '&' : '?') + 'from=' + encodeURIComponent(origin)
  }
  nav.go(path, replace)
}
/** Tab bar: replaces the entry, so back does not cycle through tabs. Tapping the active tab returns to its root. */
export const openTab = (id: string) => nav.go(tabOf(parse().raw) === id ? id : lastInTab.get(id) || id, true)
/** Native-style back: history back when the app has history, else the fallback / logical parent. */
export const back = (fallback?: string | (() => void) | null) => nav.back(fallback ?? parentRoute(parse().raw, parentOf) ?? HOME)
export const exit = (fallback?: string | (() => void) | null) => nav.exit(fallback ?? parentRoute(parse().raw, parentOf) ?? HOME)
export const hasHistory = () => nav.depth > 1
/** Tie an open sheet/modal/player to a history entry: system back closes it first. */
export function useLayer(open: boolean, close: () => void) {
  const ref = useRef(close); ref.current = close
  useEffect(() => {
    if (!open) return
    const id = nav.pushLayer(() => ref.current())
    return () => nav.removeLayer(id)
  }, [open])
}
