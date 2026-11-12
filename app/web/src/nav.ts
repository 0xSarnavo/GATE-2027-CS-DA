/**
 * Navigation model, kept free of DOM globals so it can be unit tested with a fake History.
 *
 * Every history entry carries `{ i, l, g }`:
 *  - i: in-app depth. 1 is the first screen of this app session; a pushed screen is i + 1.
 *  - l: number of open layers (sheets, modals, video player, lightbox) on that entry. A layer is a
 *       history entry with the same URL, so the Android back gesture pops it and closes the layer.
 *  - g: the guard entry under the first screen. Back from the first screen lands on it, and we then
 *       walk up the logical parents (or ask "back again to exit" on Today) instead of leaving the app.
 */
export interface HistoryLike {
  state: any
  pushState(state: any, title: string, url?: string): void
  replaceState(state: any, title: string, url?: string): void
  back(): void
  go(delta: number): void
}
export interface NavEnv {
  raw(): string
  now(): number
  toast(message: string): void
  notify(): void
  parentOf?(topicId: string): string | null | undefined
}

const TAB_ROOTS = ['today', 'learn', 'practice', 'test', 'cards', 'plan', 'log', 'stats', 'settings', 'insights', 'mistakes', 'calendar', 'search']
export const HOME = 'today'

export const tabOf = (path: string) => {
  const first = path.split(/[/?]/)[0]
  return first === 'q' || first === 'mistakes' || first === 'priority' || first === 'drill' ? 'practice' : first === 'dev' ? 'settings' : first === 'calendar' ? 'plan' : first
}
export const isHome = (raw: string) => { const p = raw.split('?')[0].replace(/\/+$/, ''); return p === '' || p === HOME }

/** The screen "one level up" for a route; null for Today. `parentOf` lets Learn/Practice resolve subject -> chapter. */
export function parentRoute(raw: string, parentOf?: (topicId: string) => string | null | undefined): string | null {
  const parts = raw.split('?')[0].split('/').filter(Boolean)
  const [a, b, c] = parts
  if (!a || a === HOME) return null
  if (parts.length === 1) return TAB_ROOTS.includes(a) || ['priority', 'drill'].includes(a) ? (a === 'priority' || a === 'drill' ? 'practice' : HOME) : HOME
  switch (a) {
    case 'learn': {
      if (b === 'sheet' || b === 'course' || b === 'readiness') return c ? 'learn/' + c : 'learn'
      if (c) return `learn/${b}`
      const p = parentOf?.(b); return p ? 'learn/' + p : 'learn'
    }
    case 'practice': { const p = parentOf?.(b); return p ? 'practice/' + p : 'practice' }
    case 'q': {
      const from = new URLSearchParams(raw.split('?')[1] ?? '').get('from')
      return from && !from.startsWith('q/') && !from.startsWith('/') ? from : 'practice'
    }
    case 'test': return 'test'
    case 'cards': return 'cards'
    case 'plan': return 'plan'
    case 'insights': return HOME
    default: return HOME
  }
}

export class Nav {
  layers: { id: number; close: () => void }[] = []
  private seq = 0
  private pending = 0
  private deferred: (() => void)[] = []
  private unguarded = false
  private exitAt = -1e12
  forceReplace = false
  constructor(private h: HistoryLike, private env: NavEnv) {}

  get depth(): number { return this.h.state?.i ?? 1 }

  /** Call once at startup. A fresh load (no state) is depth 1 and still needs a guard entry below it. */
  init() {
    if (this.h.state?.i == null) { this.h.replaceState({ i: 1, l: 0 }, '', '#/' + this.env.raw()); this.unguarded = true }
  }
  /** Needs a user gesture in Chrome, otherwise "back" skips the entry. Safe to call repeatedly. */
  armGuard() {
    if (!this.unguarded || this.h.state?.i !== 1 || (this.h.state?.l ?? 0) !== 0) return
    this.unguarded = false
    const url = '#/' + this.env.raw()
    this.h.replaceState({ i: 0, g: 1, l: 0 }, '', url)
    this.h.pushState({ i: 1, l: 0 }, '', url)
  }

  private settled(fn: () => void) { if (this.pending > 0) this.deferred.push(fn); else fn() }

  /** Close every open layer (without calling their handlers' side effects twice), then run `then` when history has settled. */
  private unwindLayers(then: () => void) {
    if (!this.layers.length) return then()
    const ls = this.layers.splice(0), k = Math.min(ls.length, this.h.state?.l ?? 0)
    if (k > 0) { this.pending++; this.deferred.push(then) } // set first: close handlers that call back() must be ignored
    for (const l of ls) l.close()
    if (k > 0) this.h.go(-k); else then()
  }

  go(path: string, replace = false) {
    const raw = path.replace(/^[#/]+/, '')
    this.settled(() => this.unwindLayers(() => {
      this.armGuard()
      const url = '#/' + raw
      const d = this.depth
      if (replace || this.forceReplace) this.h.replaceState({ i: d, l: 0 }, '', url)
      else if (this.env.raw() !== raw) this.h.pushState({ i: d + 1, l: 0 }, '', url)
      this.env.notify()
    }))
  }

  /** Header arrow / app "close" buttons: history back when the app has history, else go to the logical parent (replacing). */
  back(fallback?: string | (() => void) | null) {
    if (this.pending > 0) return
    if (this.layers.length || this.depth > 1) { this.h.back(); return }
    this.forceReplace = true
    try {
      if (typeof fallback === 'function') fallback()
      else this.go(fallback || parentRoute(this.env.raw()) || HOME, true)
    } finally { this.forceReplace = false }
  }

  /** Leave the current screen for good: close open layers, then back (or the fallback when the app has no history). */
  exit(fallback?: string | (() => void) | null) { this.settled(() => this.unwindLayers(() => this.back(fallback))) }

  /** Register an open layer. Returns an id for removeLayer. */
  pushLayer(close: () => void): number {
    const id = ++this.seq
    this.settled(() => {
      this.armGuard()
      this.layers.push({ id, close })
      this.h.pushState({ i: this.depth, l: this.layers.length }, '', '#/' + this.env.raw())
    })
    return id
  }
  /** The UI closed the layer (button, scrim, Escape): drop its history entry. */
  removeLayer(id: number) {
    const k = this.layers.findIndex((l) => l.id === id)
    if (k < 0) return
    const wasTop = k === this.layers.length - 1 && (this.h.state?.l ?? 0) === this.layers.length
    this.layers.splice(k, 1)
    if (wasTop) { this.pending++; this.h.back() }
  }

  /** popstate (hardware back, gesture, history.back, forward). */
  onPop() {
    if (this.pending > 0) this.pending--
    const s = this.h.state ?? { i: 1, l: 0 }
    const l = s.l ?? 0
    while (this.layers.length > l) { const top = this.layers.pop()!; top.close() }
    if (s.g) this.guardHit()
    else this.env.notify()
    if (this.pending === 0 && this.deferred.length) { const run = this.deferred.splice(0); run.forEach((f) => f()) }
  }

  private guardHit() {
    const raw = this.env.raw()
    const parent = isHome(raw) ? null : parentRoute(raw, this.env.parentOf)
    const to = '#/' + (parent ?? raw)
    if (parent === null) {
      if (this.env.now() - this.exitAt < 2000) { this.exitAt = -1e12; this.h.back(); return }
      this.exitAt = this.env.now()
      this.env.toast('Press back again to exit')
    }
    this.h.replaceState({ i: 0, g: 1, l: 0 }, '', to)
    this.h.pushState({ i: 1, l: 0 }, '', to)
    this.env.notify()
  }
}
