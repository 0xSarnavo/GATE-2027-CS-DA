import { get as idbGet, set as idbSet } from 'idb-keyval'
import { useEffect, useState } from 'preact/hooks'
import { uuid7 } from './util'

export interface OutboxItem { id: string; method: string; path: string; body?: unknown; ts: number; tries: number; failed?: string }

export const kv = {
  get: async <T,>(k: string): Promise<T | undefined> => { try { return await idbGet(k) } catch { return undefined } },
  set: async (k: string, v: unknown) => { try { await idbSet(k, v) } catch { /* private mode etc. */ } },
}

// ---- tiny observable sync state ----
export interface SyncState { offline: boolean; queued: number; failed: number; syncing: boolean; updateReady: boolean; error?: string }
let state: SyncState = { offline: typeof navigator !== 'undefined' && !navigator.onLine, queued: 0, failed: 0, syncing: false, updateReady: false }
const subs = new Set<() => void>()
export function setSync(p: Partial<SyncState>) { state = { ...state, ...p }; subs.forEach((f) => f()) }
export function useSync(): SyncState {
  const [, f] = useState(0)
  useEffect(() => { const s = () => f((n) => n + 1); subs.add(s); return () => { subs.delete(s) } }, [])
  return state
}
export const syncState = () => state

// ---- outbox (queued writes, idempotent via client ids + Idempotency-Key) ----
let outbox: OutboxItem[] | null = null
let loading: Promise<OutboxItem[]> | null = null
let saving = Promise.resolve()
async function load(): Promise<OutboxItem[]> {
  if (outbox) return outbox
  loading ??= idbGet<OutboxItem[]>('outbox').then(x => (outbox = x || []))
  try { return await loading } catch (e) { loading = null; throw e }
}
async function save() {
  const snapshot = outbox!.map(x => ({ ...x }))
  setSync({ queued: snapshot.length, failed: snapshot.filter(x => x.failed).length })
  saving = saving.catch(() => {}).then(() => idbSet('outbox', snapshot))
  try { await saving; setSync({ error: undefined }) }
  catch (e) { setSync({ error: `Offline storage unavailable: ${String(e)}` }); throw e }
}
export async function enqueue(method: string, path: string, body?: unknown, id?: string): Promise<OutboxItem> {
  const o = await load()
  const it = { id: id ?? uuid7(), method, path, body, ts: Date.now(), tries: 0 }
  o.push(it); await save(); return it
}
export async function initOutbox() { await load(); setSync({ queued: outbox!.length, failed: outbox!.filter(x => x.failed).length }) }
export async function retryFailed() { const o = await load(); for (const it of o) delete it.failed; await save() }
export async function drain(send: (it: OutboxItem) => Promise<'ok' | 'retry' | { failed: string }>) {
  const o = await load()
  if (!o.length || state.syncing) return
  setSync({ syncing: true })
  try {
    while (o.some(x => !x.failed)) {
      const i = o.findIndex(x => !x.failed)
      const r = await send(o[i])
      if (r === 'retry') { o[i].tries++; break }
      if (r === 'ok') o.splice(i, 1)
      else o[i].failed = r.failed
      await save()
    }
  } finally { try { await save() } finally { setSync({ syncing: false }) } }
}

// ---- display preferences (per device) ----
export interface Prefs { detail: 'focus' | 'full'; showOutside: boolean; showPre2017: boolean; haptics: boolean; papers: 'CS' | 'DA' | 'both'; sortW: boolean; simple: boolean }

// ---- theme: system | light | dark (manual override via the data-theme hook) ----
export type Theme = 'system' | 'light' | 'dark'
const TK = 'gate.theme'
export const getTheme = (): Theme => { try { const v = localStorage.getItem(TK); return v === 'light' || v === 'dark' ? v : 'system' } catch { return 'system' } }
export function applyTheme(t: Theme = getTheme()) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t)
}
export function setTheme(t: Theme) { try { if (t === 'system') localStorage.removeItem(TK); else localStorage.setItem(TK, t) } catch { /* private mode */ } applyTheme(t) }
const PK = 'gate.prefs'
function loadPrefs(): Prefs {
  try { return { detail: 'focus', showOutside: false, showPre2017: true, haptics: false, papers: 'both', sortW: false, simple: false, ...JSON.parse(localStorage.getItem(PK) || '{}') } } catch { return { detail: 'focus', showOutside: false, showPre2017: true, haptics: false, papers: 'both', sortW: false, simple: false } }
}
let prefs: Prefs = loadPrefs()
const psubs = new Set<() => void>()
export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...prefs, ...p }
  try { localStorage.setItem(PK, JSON.stringify(prefs)) } catch { /* private mode */ }
  psubs.forEach((f) => f())
}
export function usePrefs(): Prefs {
  const [, f] = useState(0)
  useEffect(() => { const s = () => f((n) => n + 1); psubs.add(s); return () => { psubs.delete(s) } }, [])
  return prefs
}
