import { useEffect, useRef, useState } from 'preact/hooks'
import { useSync } from './store'
import { Icon, Sheet } from './ui'
import { Md } from './md'
import { isMidTask, updateAction } from './update-policy'

export interface Changelog { version: string; build?: string; date?: string; items: string[] }
const BK = 'gate.build' // the build this device last ran
const LK = 'gate.later' // the waiting build the user said "Later" to (the card never comes back for it)
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

/** Newest changelog from the network (never from the SW cache), or null when offline. */
export async function loadChangelog(): Promise<Changelog | null> {
  try {
    const r = await fetch('/changelog.json', { cache: 'no-store' }); if (!r.ok) return null
    const j = await r.json()
    return j && typeof j.version === 'string' ? { version: j.version, build: typeof j.build === 'string' ? j.build : undefined, date: j.date, items: Array.isArray(j.items) ? j.items.map(String) : [] } : null
  } catch { return null }
}
export const applyUpdate = () => navigator.serviceWorker?.getRegistration().then((g) => g?.waiting?.postMessage('skipWaiting'))

export function inputOrOverlayOpen(): boolean {
  const a = document.activeElement as HTMLElement | null
  const typing = !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes((a as HTMLInputElement).type)))
  return typing || !!document.querySelector('.sheet, .video-sheet:not(.mini), .calc, .lightbox, .exam')
}
/**
 * New versions are applied silently on any calm screen (right away, including on a cold start). Only when
 * the user is mid-question or mid-test does a small card appear; "Later" is remembered per build and the
 * update is applied as soon as they finish.
 */
export function UpdateCard() {
  const s = useSync()
  const [cl, setCl] = useState<Changelog | null>(null)
  const [, bump] = useState(0)
  const applied = useRef(false)
  useEffect(() => { if (s.updateReady) loadChangelog().then(setCl) }, [s.updateReady])
  useEffect(() => {
    if (!s.updateReady) return
    const f = () => bump((n) => n + 1)
    addEventListener('hashchange', f); addEventListener('popstate', f); const t = setInterval(f, 1500)
    return () => { removeEventListener('hashchange', f); removeEventListener('popstate', f); clearInterval(t) }
  }, [s.updateReady])
  const mid = isMidTask(location.hash)
  const action = !mid && inputOrOverlayOpen() ? 'none' : updateAction(s.updateReady, mid, ls.get(LK), cl?.build ?? null)
  useEffect(() => { if (action === 'apply' && !applied.current) { applied.current = true; applyUpdate() } }, [action])
  if (action !== 'card') return null
  return (
    <section class="upd card" role="region" aria-label="App update">
      <div class="upd-h"><span class="upd-ic"><Icon.bolt size={22} /></span><div><b>New version ready</b>{cl && <small>v{cl.version}</small>}</div></div>
      <p class="muted upd-n">It installs when you finish this.</p>
      <div class="upd-b"><button class="btn sm" onClick={() => { ls.set(LK, cl!.build!); bump((n) => n + 1) }}>Later</button><button class="btn primary sm grow" onClick={() => { applied.current = true; applyUpdate() }}>Update now</button></div>
    </section>
  )
}

/** Decided once per page load. A new running build means we just updated. */
let noteOnce: Promise<Changelog | null> | null = null
const updatedNote = () => (noteOnce ??= (async () => {
  const prev = ls.get(BK); ls.set(BK, __BUILD_ID__)
  if (!prev || prev === __BUILD_ID__) return null
  const c = await loadChangelog()
  return c && (!c.build || c.build === __BUILD_ID__) ? c : { version: __APP_VERSION__, items: [] }
})())

/** After an update: a 3-second "Updated · see what's new" toast. Tapping it opens the notes. */
export function UpdatedNote() {
  const [cl, setCl] = useState<Changelog | null>(null)
  const [show, setShow] = useState(false), [open, setOpen] = useState(false)
  useEffect(() => { updatedNote().then((c) => { if (c) { setCl(c); setShow(true) } }) }, [])
  useEffect(() => { if (!show) return; const t = setTimeout(() => setShow(false), 3000); return () => clearTimeout(t) }, [show])
  if (!cl) return null
  return (
    <>
      {show && !open && <button class="upd-toast" role="status" onClick={() => { setShow(false); setOpen(true) }}><Icon.check size={18} /><span>Updated · see what's new</span></button>}
      {open && (
        <Sheet title={`What's new in v${cl.version}`} onClose={() => setOpen(false)}>
          {cl.items.length ? <ul class="upd-l">{cl.items.map((i) => <li><Md text={i} /></li>)}</ul> : <p class="muted">Fixes and improvements.</p>}
          <button class="btn primary block" onClick={() => setOpen(false)}>Got it</button>
        </Sheet>
      )}
    </>
  )
}
