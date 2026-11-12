import { useEffect } from 'preact/hooks'
import { write } from './api'
import { today, uuid7 } from './util'

type Context = { kind: 'study' | 'job'; topic_id?: string }
let study: string | null = null
let video: string | null = null
let videoOpen = false
let job = false
let active: Context | null = null
let elapsed = 0
let lastTick = Date.now()
let lastInput = Date.now()
let installed = false
const current = (): Context | null => videoOpen ? (video ? { kind: 'study', topic_id: video } : null) : job ? { kind: 'job' } : study ? { kind: 'study', topic_id: study } : null

function flush() {
  if (!active || elapsed < 1000) return
  const seconds = Math.min(120, Math.floor(elapsed / 1000))
  elapsed -= seconds * 1000
  void write('POST', '/plan/active-time', { id: uuid7(), date: today(), ...active, seconds }).catch(console.error)
}
function switchContext() {
  flush()
  active = current()
  elapsed = 0
  lastTick = Date.now()
}
function tick() {
  const now = Date.now(), delta = Math.max(0, Math.min(2000, now - lastTick))
  lastTick = now
  if (document.visibilityState !== 'visible' || now - lastInput >= 120_000 || !active) return
  elapsed += delta
  if (elapsed >= 60_000) flush()
}
export function startActiveTime() {
  if (installed) return
  installed = true
  for (const event of ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const) addEventListener(event, () => { lastInput = Date.now() }, { passive: true })
  addEventListener('visibilitychange', () => { tick(); if (document.visibilityState === 'hidden') flush(); lastTick = Date.now() })
  addEventListener('pagehide', () => { tick(); flush() })
  setInterval(tick, 1000)
}
export function useActiveStudy(topic: string | null | undefined) {
  useEffect(() => { study = topic || null; switchContext(); return () => { study = null; switchContext() } }, [topic])
}
export function setVideoActive(topic: string | null, open: boolean) { video = topic; videoOpen = open; switchContext() }
export function setJobActive(on: boolean) { job = on; switchContext() }
