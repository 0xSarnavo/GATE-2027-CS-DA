import { useEffect, useState } from 'preact/hooks'

const fmtIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
let todayOffset = 0
export function setToday(d: string) {
  if (/^\d{4}-\d\d-\d\d$/.test(d)) todayOffset = (Date.parse(d + 'T00:00:00Z') - Date.parse(fmtIST.format(new Date()) + 'T00:00:00Z')) / 864e5
}
export function today(at = new Date()): string { return fmtIST.format(new Date(at.getTime() + todayOffset * 864e5)) }
export function addDays(d: string, n: number): string {
  const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10)
}
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5)
}
export function fmtDate(d: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' })
}
export function fmtMin(m: number): string {
  m = Math.round(m || 0); const h = Math.floor(m / 60), r = m % 60
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`
}
export function mmss(s: number) { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
export function uuid7(): string {
  const ts = Date.now().toString(16).padStart(12, '0')
  const r = crypto.getRandomValues(new Uint8Array(10)); const h = [...r].map((b) => b.toString(16).padStart(2, '0')).join('')
  const v = '7' + h.slice(0, 3), variant = ((parseInt(h.slice(3, 5), 16) & 0x3f) | 0x80).toString(16)
  return `${ts.slice(0, 8)}-${ts.slice(8)}-${v}-${variant}${h.slice(5, 7)}-${h.slice(7, 19)}`
}
export function shuffle<T>(a: T[]): T[] {
  const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } return b
}
export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')
export const arr = <T,>(r: any, key = 'items'): T[] => (Array.isArray(r) ? r : Array.isArray(r?.[key]) ? r[key] : [])

export function useLongPress(cb: () => void, ms = 480) {
  let t: any, fired = false
  const clear = () => clearTimeout(t)
  return {
    onTouchStart: () => { fired = false; t = setTimeout(() => { fired = true; cb() }, ms) },
    onTouchEnd: (e: Event) => { clear(); if (fired) e.preventDefault() },
    onTouchMove: clear, onTouchCancel: clear,
    onContextMenu: (e: Event) => { e.preventDefault(); cb() },
  }
}

export function useNow(ms = 1000) {
  const [n, setN] = useState(Date.now())
  useEffect(() => { const i = setInterval(() => setN(Date.now()), ms); return () => clearInterval(i) }, [ms])
  return n
}
