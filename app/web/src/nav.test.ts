import { describe, expect, test } from 'bun:test'
import { Nav, parentRoute, type HistoryLike } from './nav'

/** Synchronous stand-in for window.history that fires onPop like the browser does after back()/go(). */
function setup(start = 'today', fresh = true, parentOf?: (id: string) => string | null | undefined) {
  const entries: { state: any; url: string }[] = [{ state: fresh ? null : { i: 1, l: 0 }, url: start }]
  let idx = 0
  const toasts: string[] = []
  let exited = false, notifies = 0
  let nav: Nav
  const h: HistoryLike = {
    get state() { return entries[idx].state },
    pushState(s, _t, u) { entries.splice(idx + 1); entries.push({ state: s, url: (u ?? '#/' + entries[idx].url).replace(/^#\//, '') }); idx++ },
    replaceState(s, _t, u) { entries[idx] = { state: s, url: u != null ? u.replace(/^#\//, '') : entries[idx].url } },
    back() { h.go(-1) },
    go(d) { const n = idx + d; if (n < 0) { exited = true; return } idx = n; nav.onPop() },
  }
  let t = 1000
  nav = new Nav(h, { raw: () => entries[idx].url, now: () => t, toast: (m) => toasts.push(m), notify: () => { notifies++ }, parentOf })
  nav.init()
  return { nav, h, entries, toasts, route: () => entries[idx].url, depth: () => idx, tick: (ms: number) => { t += ms }, exited: () => exited, notifies: () => notifies }
}

describe('parentRoute', () => {
  const sub = (id: string) => ({ 'algo.dp': 'algo' } as Record<string, string>)[id]
  test('Today has no parent; tab roots go to Today', () => {
    expect(parentRoute('today')).toBeNull(); expect(parentRoute('')).toBeNull()
    for (const r of ['learn', 'practice', 'test', 'cards', 'plan', 'settings', 'calendar', 'search']) expect(parentRoute(r)).toBe('today')
  })
  test('concept reader -> chapter -> subject -> Learn', () => {
    expect(parentRoute('learn/algo.dp/d1', sub)).toBe('learn/algo.dp')
    expect(parentRoute('learn/algo.dp', sub)).toBe('learn/algo')
    expect(parentRoute('learn/algo', sub)).toBe('learn')
  })
  test('question, test, plan, cards', () => {
    expect(parentRoute('q/gen.algo.dp.001')).toBe('practice')
    expect(parentRoute('q/gen.algo.dp.001?from=learn%2Falgo.dp%2Fd1')).toBe('learn/algo.dp/d1')
    expect(parentRoute('learn/readiness/algo.dp')).toBe('learn/algo.dp')
    expect(parentRoute('learn/course/algo')).toBe('learn/algo')
    expect(parentRoute('practice/algo.dp', sub)).toBe('practice/algo')
    expect(parentRoute('test/result/x')).toBe('test'); expect(parentRoute('test/run/x')).toBe('test')
    expect(parentRoute('plan/2026-10-08')).toBe('plan'); expect(parentRoute('cards/review')).toBe('cards')
    expect(parentRoute('priority')).toBe('practice')
  })
})

describe('Nav', () => {
  test('pushed screens add history; back uses history', () => {
    const s = setup('today'); s.nav.armGuard()
    s.nav.go('learn'); s.nav.go('learn/algo.dp'); s.nav.go('learn/algo.dp/d1')
    expect(s.nav.depth).toBe(4)
    s.nav.back(); expect(s.route()).toBe('learn/algo.dp')
    s.nav.back(); expect(s.route()).toBe('learn')
  })
  test('go to the same route does not add an entry; replace keeps depth', () => {
    const s = setup('today'); s.nav.armGuard(); s.nav.go('learn'); const d = s.nav.depth
    s.nav.go('learn'); expect(s.nav.depth).toBe(d)
    s.nav.go('practice', true); expect(s.nav.depth).toBe(d); expect(s.route()).toBe('practice')
  })
  test('deep link: header back goes to logical parent, replacing the entry', () => {
    const s = setup('learn/algo.dp', true)
    s.nav.back(); expect(s.route()).toBe('learn'); expect(s.nav.depth).toBe(1)
    expect(s.exited()).toBe(false)
  })
  test('deep linked question returns to its recorded origin', () => {
    const s = setup('q/gen.algo.dp.001?from=learn%2Falgo.dp%2Fd1', true)
    s.nav.back(parentRoute(s.route()))
    expect(s.route()).toBe('learn/algo.dp/d1')
    expect(s.exited()).toBe(false)
  })
  test('back with a custom fallback only when there is no history', () => {
    const s = setup('learn/algo.dp/d1', true)
    s.nav.back(() => s.nav.go('learn/algo.dp')); expect(s.route()).toBe('learn/algo.dp')
    s.nav.go('learn/algo.dp/d2'); s.nav.back(() => s.nav.go('learn')); expect(s.route()).toBe('learn/algo.dp')
  })
  test('hardware back from a deep link walks up the parents, then asks before exiting', () => {
    const s = setup('learn/algo.dp/d1', true); s.nav.armGuard()
    s.h.back(); expect(s.route()).toBe('learn/algo.dp')
    s.h.back(); expect(s.route()).toBe('learn')
    s.h.back(); expect(s.route()).toBe('today')
    s.h.back(); expect(s.route()).toBe('today'); expect(s.toasts).toEqual(['Press back again to exit']); expect(s.exited()).toBe(false)
    s.tick(500); s.h.back() // second back within 2 s leaves the app
    expect(s.exited()).toBe(true)
  })
  test('hardware back from a chapter deep link uses the loaded subject parent', () => {
    const s = setup('learn/algo.dp', true, (id) => id === 'algo.dp' ? 'algo' : null)
    s.nav.armGuard()
    s.h.back(); expect(s.route()).toBe('learn/algo')
    s.h.back(); expect(s.route()).toBe('learn')
  })
  test('exit prompt expires after 2 s', () => {
    const s = setup('today', true); s.nav.armGuard()
    s.h.back(); expect(s.toasts.length).toBe(1)
    s.tick(5000); s.h.back(); expect(s.toasts.length).toBe(2); expect(s.exited()).toBe(false)
  })
  test('layers: system back closes the sheet and stays on the route', () => {
    const s = setup('learn', true); s.nav.armGuard(); s.nav.go('learn/algo.dp')
    let open = true; s.nav.pushLayer(() => { open = false })
    expect(s.nav.layers.length).toBe(1)
    s.h.back(); expect(open).toBe(false); expect(s.route()).toBe('learn/algo.dp'); expect(s.nav.layers.length).toBe(0)
    s.nav.back(); expect(s.route()).toBe('learn')
  })
  test('layers: closing from the UI drops its history entry', () => {
    const s = setup('today', true); s.nav.armGuard(); s.nav.go('plan')
    const d = s.nav.depth; const id = s.nav.pushLayer(() => {})
    expect(s.nav.depth).toBe(d); s.nav.removeLayer(id)
    expect(s.nav.layers.length).toBe(0); s.nav.back(); expect(s.route()).toBe('today')
  })
  test('navigating while a sheet is open unwinds it first, no dead entries', () => {
    const s = setup('today', true); s.nav.armGuard()
    let open = true; s.nav.pushLayer(() => { open = false })
    s.nav.go('plan'); expect(open).toBe(false); expect(s.route()).toBe('plan')
    s.nav.back(); expect(s.route()).toBe('today')
  })
  test('submit flow: replacing the test route while its leave-guard layer is up leaves [test, result]', () => {
    const s = setup('test', true); s.nav.armGuard(); s.nav.go('test/run/1'); s.nav.pushLayer(() => {})
    s.nav.go('test/result/1', true); expect(s.route()).toBe('test/result/1')
    s.nav.back(); expect(s.route()).toBe('test')
  })
  test('leave-guard: back is intercepted, user stays, guard re-arms', () => {
    const s = setup('test', true); s.nav.armGuard(); s.nav.go('test/run/1')
    let asked = 0
    const arm = () => s.nav.pushLayer(() => { asked++ })
    arm(); s.h.back(); expect(asked).toBe(1); expect(s.route()).toBe('test/run/1')
    arm(); s.h.back(); expect(asked).toBe(2); expect(s.route()).toBe('test/run/1')
    s.nav.back(); expect(s.route()).toBe('test') // user confirmed leaving
  })
  test('tab switches replace the entry, so back does not cycle tabs', () => {
    const s = setup('today', true); s.nav.armGuard()
    s.nav.go('learn', true); s.nav.go('practice', true); s.nav.go('test', true)
    expect(s.nav.depth).toBe(1)
    s.h.back(); expect(s.route()).toBe('today') // guard turns "test" into its parent
  })
  test('survives a reload: depth is kept from history.state', () => {
    const s = setup('learn/algo.dp', false)
    expect(s.nav.depth).toBe(1)
  })
})
