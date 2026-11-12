import { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { cx } from './util'
import { back, go, openTab, useLayer } from './router'
import { useSync, syncState, retryFailed } from './store'
import { flush, getToday } from './api'
import { xpToday, onXp } from './queue'
import { getReports } from './api'
import { tabs, extras, useModules } from './modules'

// ---------- data loading ----------
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], peekFn?: () => Promise<T | undefined>) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const run = () => {
    const n = ++seq.current
    setError('')
    peekFn?.().then((c) => { if (c !== undefined && n === seq.current) { setData((d) => d ?? c); setLoading(false) } })
    fn().then((r) => { if (n === seq.current) { setData(r); setLoading(false) } })
      .catch((e) => { if (n === seq.current) { setError(e?.message || 'Failed to load'); setLoading(false) } })
  }
  useEffect(run, deps)
  return { data, error, loading: loading && data === undefined, reload: run, set: setData }
}

// ---------- toast ----------
let toastFn: (m: string, action?: { label: string; run: () => void }, ms?: number) => void = () => {}
export const toast = (m: string, action?: { label: string; run: () => void }, ms?: number) => toastFn(m, action, ms)
export function Toasts() {
  const [item, setItem] = useState<{ message: string; action?: { label: string; run: () => void } } | null>(null)
  const t = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => { toastFn = (message, action, ms = 5000) => { setItem({ message, action }); clearTimeout(t.current); t.current = setTimeout(() => setItem(null), ms) }; return () => clearTimeout(t.current) }, [])
  return item ? <div class="toast row between" role="status"><span>{item.message}</span>{item.action && <button class="toast-undo" onClick={() => { item.action!.run(); setItem(null) }}>{item.action.label}</button>}</div> : null
}

// ---------- icons ----------
const I = (d: string, extra = '') => ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d + extra }} />
)
export const Icon = {
  today: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  plan: I('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  practice: I('<path d="M4 5h16v14H4z"/><path d="M8 10h8M8 14h5"/>'),
  cards: I('<rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>'),
  log: I('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>'),
  more: I('<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>'),
  back: I('<path d="M15 5l-7 7 7 7"/>'),
  search: I('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'),
  chart: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  flag: I('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  chev: I('<path d="M9 6l6 6-6 6"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  play: I('<path d="M8 5l11 7-11 7z"/>'),
  close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  flame: I('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.4 1 2 2 2 0-3-.5-5 1-8z"/>'),
  bolt: I('<path d="M13 3L5 13.5h6L10 21l9-11h-6z"/>'),
  gem: I('<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l-2 5 5 11 5-11-2-5"/>'),
  lock: I('<rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  crown: I('<path d="M4 18h16l1-10-5 4-4-7-4 7-5-4z"/>'),
  star: I('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  starFill: ({ size = 22 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>,
  book: I('<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 1 2-2h13v3H6a2 2 0 0 1-2-2zM9 7h6"/>'),
  bulb: I('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'),
  trophy: I('<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8 21h8M9 18h6"/>'),
  user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  code: I('<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>'),
  data: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  layers: I('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  abc: I('<path d="M4 17l3.5-9L11 17M5.3 14h4.4M14 8v9M14 11h3a2 2 0 0 1 0 4h-3M20 8v9"/>'),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  swap: I('<path d="M7 7h12l-3-3M17 17H5l3 3"/>'),
  note: I('<path d="M5 3h14v18l-4-3-3 3-3-3-4 3z"/><path d="M9 8h6M9 12h6"/>'),
  target: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  calc: I('<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>'),
  grid: I('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>'),
  cal: I('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>'),
  menu: I('<path d="M4 7h16M4 12h16M4 17h16"/>'),
}
export const SubjIcon = ({ scope, size = 22 }: { scope?: string; size?: number }) => {
  const C = scope === 'cs' ? Icon.code : scope === 'da' ? Icon.data : scope === 'ga' ? Icon.abc : Icon.layers
  return <C size={size} />
}
export const SCOPE_NAME: Record<string, string> = { shared: 'Common to both papers', cs: 'Computer Science', da: 'Data Science and AI', ga: 'General Aptitude' }

// ---------- illustrations: simple shapes, no mascot ----------
export function Art({ kind = 'empty' }: { kind?: 'empty' | 'trophy' | 'rest' | 'cards' | 'target' }) {
  const o = '#ff7a00', oe = '#cc5f00', k = 'var(--text)', w = 'var(--surface)', g = '#ffc800', ge = '#e5b400'
  return (
    <svg class="art" viewBox="0 0 160 130" role="img" aria-hidden="true">
      <ellipse cx="80" cy="118" rx="52" ry="7" fill="var(--track)" />
      {kind === 'trophy' && <>
        <path d="M50 22h60v26a30 30 0 0 1-60 0z" fill={g} stroke={ge} stroke-width="4" /><path d="M50 30H32v8a18 18 0 0 0 18 18M110 30h18v8a18 18 0 0 1-18 18" fill="none" stroke={ge} stroke-width="6" stroke-linecap="round" />
        <rect x="72" y="78" width="16" height="20" fill={ge} /><rect x="54" y="98" width="52" height="14" rx="6" fill={o} stroke={oe} stroke-width="4" /><path d="M80 34l4 9 10 1-7.500 6.500 2.500 9.500-9-5-9 5 2.500-9.500L66 44l10-1z" fill="#fff" opacity=".85" />
      </>}
      {kind === 'rest' && <>
        <circle cx="80" cy="58" r="34" fill={o} stroke={oe} stroke-width="5" /><path d="M64 56q6-8 12 0M84 56q6-8 12 0" stroke="#0a0a0a" stroke-width="5" fill="none" stroke-linecap="round" /><path d="M68 74q12 10 24 0" stroke="#0a0a0a" stroke-width="5" fill="none" stroke-linecap="round" />
        <path d="M118 28h14l-14 16h14" stroke={k} stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" /><path d="M132 14h9l-9 10h9" stroke={k} stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </>}
      {kind === 'cards' && <>
        <rect x="34" y="34" width="70" height="52" rx="12" fill={w} stroke={k} stroke-width="4" transform="rotate(-10 69 60)" /><rect x="56" y="30" width="70" height="52" rx="12" fill={o} stroke={oe} stroke-width="4" transform="rotate(8 91 56)" /><path d="M78 56h26M78 66h16" stroke="#0a0a0a" stroke-width="5" stroke-linecap="round" transform="rotate(8 91 56)" />
      </>}
      {kind === 'target' && <>
        <circle cx="80" cy="60" r="42" fill={w} stroke={k} stroke-width="5" /><circle cx="80" cy="60" r="26" fill={o} stroke={oe} stroke-width="4" /><circle cx="80" cy="60" r="10" fill="#0a0a0a" /><path d="M80 60l34-34" stroke={k} stroke-width="5" stroke-linecap="round" /><path d="M108 22l10 2-2 10z" fill={k} />
      </>}
      {kind === 'empty' && <>
        <rect x="38" y="26" width="84" height="76" rx="16" fill={w} stroke={k} stroke-width="5" /><circle cx="62" cy="58" r="9" fill={o} /><rect x="80" y="52" width="30" height="12" rx="6" fill="var(--track)" /><rect x="52" y="78" width="58" height="12" rx="6" fill="var(--track)" /><path d="M112 20l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={g} />
      </>}
    </svg>
  )
}

// ---------- celebration: CSS-only confetti, ~1s, hidden under reduced motion (CSS) ----------
export function Confetti({ fire }: { fire: boolean }) {
  const [on, setOn] = useState(false)
  useEffect(() => { if (!fire) return; if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; setOn(true); const t = setTimeout(() => setOn(false), 1300); return () => clearTimeout(t) }, [fire])
  if (!on) return null
  const colors = ['#ff7a00', '#ffc800', '#ffffff', '#1f9d55', '#cc5f00', '#0a0a0a']
  return (
    <div class="confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => <i style={{ '--l': (i * 2.8 + (i % 3) * 1.5) % 100 + '%', '--r': (i * 47) % 360 + 'deg', '--dx': ((i % 7) - 3) * 18 + 'px', '--d': (i % 9) * 40 + 'ms', '--c': colors[i % colors.length] } as any} />)}
    </div>
  )
}

// ---------- layout ----------
export function SyncPill() {
  const s = useSync()
  if (!s.offline && !s.queued && !s.syncing && !s.error) return null
  const label = s.error ? 'Offline storage unavailable' : s.failed ? `${s.failed} writes need attention` : s.offline ? (s.queued ? `Offline - ${s.queued} queued` : 'Offline') : s.syncing ? 'Syncing...' : `${s.queued} queued`
  return (
    <button class={cx('pill sync', s.offline && 'off')} onClick={() => { if (!s.offline) void (s.failed ? retryFailed().then(flush) : flush()).catch(e => toast(String(e))) }} aria-label={label} title={s.error || (s.failed ? 'Tap to retry rejected writes' : label)}>
      <span class="dot" />{label}
    </button>
  )
}

export function Header({ title, sub, onBack, right, menu = true }: { title: ComponentChildren; sub?: ComponentChildren; onBack?: boolean | (() => void); right?: ComponentChildren; menu?: boolean }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  useLayer(open, () => setOpen(false))
  const mods = useModules(); const inbox = useLoad(() => getReports().catch(() => null), []); const has = (id: string) => mods.some((m) => m.id === id && m.enabled)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [open])
  return (
    <header class={cx('hdr', !onBack && 'hdr-home')}>
      {onBack && <button class="icon-btn" aria-label="Back" onClick={() => back(typeof onBack === 'function' ? onBack : undefined)}><Icon.back /></button>}
      <div class="hdr-t"><h1>{title}</h1>{sub && <div class="sub">{sub}</div>}</div>
      <SyncPill />
      {right}
      {title !== 'Search' && <button class="icon-btn" aria-label="Search" onClick={() => go('search')}><Icon.search /></button>}
      {menu && (
        <div class="menu-wrap">
          <button ref={btn} class="icon-btn" aria-label="Profile menu: plan, log, stats, reports, settings" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon.user /></button>
          {open && (
            <>
              <div class="scrim clear" onClick={() => setOpen(false)} />
              <div class="menu" role="menu">
                {has('planner') && <button role="menuitem" autoFocus onClick={() => { setOpen(false); go('plan') }}><Icon.plan size={20} /> Plan</button>}
                {has('habits') && <button role="menuitem" onClick={() => { setOpen(false); go('log') }}><Icon.log size={20} /> Log</button>}
                {has('habits') && <button role="menuitem" onClick={() => { setOpen(false); go('stats') }}><Icon.chart size={20} /> Stats</button>}
                {has('planner') && <button role="menuitem" onClick={() => { setOpen(false); go('today?sheet=checkin') }}><Icon.check size={20} /> Check-in</button>}
                {has('planner') && <button role="menuitem" onClick={() => { setOpen(false); go('today?sheet=time') }}><Icon.clock size={20} /> Time available today</button>}
                {has('insights') && <button role="menuitem" onClick={() => { setOpen(false); go('insights/reports') }}><Icon.note size={20} /> Reports {inbox.data?.unread ? <span class="tag">{inbox.data.unread}</span> : null}</button>}
                {has('practice') && <button role="menuitem" onClick={() => { setOpen(false); go('mistakes') }}><Icon.flag size={20} /> Mistakes</button>}
                <button role="menuitem" onClick={() => { setOpen(false); go('settings') }}><Icon.gear size={20} /> Settings</button>
              </div>
            </>
          )}
        </div>
      )}
    </header>
  )
}

const TAB_ICONS: Record<string, (p: { size?: number }) => any> = { today: Icon.today, learn: Icon.book, practice: Icon.practice, test: Icon.target, cards: Icon.cards, plan: Icon.plan, log: Icon.log, stats: Icon.chart, settings: Icon.gear, insights: Icon.note }
export function TabBar({ active, hidden }: { active: string; hidden?: boolean }) {
  const modules = useModules()
  const on = (m: string) => m === 'core' || modules.some((x) => x.id === m && x.enabled)
  const item = (id: string, label: string, extra = false) => {
    const Ic = TAB_ICONS[id]
    return <a href={`#/${id}`} onClick={(e) => { e.preventDefault(); openTab(id) }} class={cx('tab', extra && 'rail-only', active === id && 'on')} aria-current={active === id ? 'page' : undefined}><Ic /><span>{label}</span></a>
  }
  return (
    <nav class="tabs" aria-label="Main" hidden={hidden}>
      {tabs.filter((t) => on(t.module)).map(({ id, label }) => item(id, label))}
      {extras.filter((t) => on(t.module)).map(({ id, label }) => item(id, label, true))}
    </nav>
  )
}

export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ComponentChildren }) {
  const el = useRef<HTMLDivElement>(null)
  useLayer(true, onClose) // system back closes the sheet first
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    if (!el.current?.contains(document.activeElement)) el.current?.focus() // inputs with autoFocus keep it
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab' || !el.current) return // keep Tab inside the dialog
      const f = [...el.current.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]')]
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    addEventListener('keydown', k); return () => { removeEventListener('keydown', k); prev?.focus?.() }
  }, [])
  return (
    <>
      <div class="scrim" onClick={onClose} />
      <div class="sheet" ref={el} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}>
        <div class="grab" />
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </>
  )
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="group">
      {options.map(([v, l]) => <button aria-pressed={value === v} class={cx(value === v && 'on')} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}
export function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="chips">
      {options.map(([v, l]) => <button class={cx('chip', value === v && 'on')} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}

export function Ring({ pct, size = 112, stroke = 10, color = 'var(--orange)', children }: { pct: number; size?: number; stroke?: number; color?: string; children?: ComponentChildren }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct))
  return (
    <div class="ring" style={{ width: size + 'px', height: size + 'px' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" stroke-width={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} stroke-width={stroke} stroke-linecap="round"
          stroke-dasharray={`${c * p} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style="transition:stroke-dasharray .4s cubic-bezier(.2,.8,.2,1)" />
      </svg>
      <div class="ring-in">{children}</div>
    </div>
  )
}
export const Bar = ({ pct, tone, label }: { pct: number; tone?: string; label?: string }) => (
  <div class="bar" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
    <i class={tone} style={{ width: Math.max(0, Math.min(1, pct)) * 100 + '%' }} />
  </div>
)
export const Empty = ({ title, children, art }: { title?: string; children?: ComponentChildren; art?: 'empty' | 'trophy' | 'rest' | 'cards' | 'target' }) => <div class="empty">{art && <Art kind={art} />}{title && <b>{title}</b>}{children}</div>
export const Spinner = () => <div class="spin" role="status" aria-label="Loading" />
export function Loading({ error, retry }: { error?: string; retry?: () => void }) {
  return error
    ? <div class="empty" role="alert"><b>Couldn't load this</b>{/fetch|network|offline/i.test(error) ? "You may be offline. Check your connection and try again." : error}<br /><button class="btn sm" onClick={retry}>Try again</button></div>
    : <div class="loading-skeleton" role="status" aria-label="Loading"><div class="skeleton" /><div class="skeleton" /><div class="skeleton" /></div>
}
export function Field({ label, children, hint }: { label: string; children: ComponentChildren; hint?: string }) {
  return <label class="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}
export function Stepper({ value, onChange, step = 1, min = 0, max = 999, suffix = '' }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <div class="stepper">
      <button type="button" aria-label="Decrease" onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>-</button>
      <output>{value}{suffix}</output>
      <button type="button" aria-label="Increase" onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}>+</button>
    </div>
  )
}
export { syncState }


/** Streak flame, XP today and cards due, each tappable. */
export function StatRow() {
  const t = useLoad(() => getToday().catch(() => undefined), [])
  const [, f] = useState(0)
  useEffect(() => onXp(() => f((n) => n + 1)), [])
  const modules = useModules()
  const streak = t.data?.streaks?.study?.current ?? 0
  const done = !!t.data?.streaks?.study?.today_done
  const cards = t.data?.due?.cards ?? 0
  const review = modules.some((m) => m.id === 'review' && m.enabled)
  return (
    <div class="stats-row" aria-label="Your stats">
      <button class={cx('spill flame', done && 'on')} onClick={() => go('stats')} aria-label={`${streak} day study streak${done ? ', done today' : ''}`}><Icon.flame size={22} />{streak}</button>
      <button class="spill xp" onClick={() => go('today')} aria-label={`${xpToday()} XP today`}><Icon.bolt size={22} />{xpToday()}<span>XP</span></button>
      {review && <button class="spill gem" onClick={() => go('cards/review')} aria-label={`${cards} cards due`}><Icon.gem size={22} />{cards}<span>due</span></button>}
    </div>
  )
}

/** Brand mark. Drop the real logo into web/public/logo.svg; until then it is the placeholder "27" tile. */
export function Logo({ size = 76 }: { size?: number }) {
  const [bad, setBad] = useState(false)
  return bad
    ? <div class="logo" style={{ width: size + 'px', height: size + 'px' }} aria-hidden="true">27</div>
    : <span class="logo-pair" style={{ width: size + 'px', height: size + 'px' }} aria-hidden="true">
        <img class="logo-img logo-on-light" src="/logo.svg" width={size} height={size} alt="" onError={() => setBad(true)} />
        <img class="logo-img logo-on-dark" src="/logo-dark.svg" width={size} height={size} alt="" />
      </span>
}

/** Plain text for copying/searching: drops Markdown/LaTeX markup but keeps the words and numbers. */
export function plainText(s = ''): string {
  return s.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, '')).replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/\\(text|mathrm|mathbf|operatorname)\{([^}]*)\}/g, '$2').replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}]/g, '')
    .replace(/[*_`#>]/g, '').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim()
}

/** "Copy", "Google it", "Ask ChatGPT" and "Ask Claude" for any question or concept. */
export function CopySearch({ text, query, kind = 'question' }: { text: string; query: string; kind?: 'question' | 'concept' }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(plainText(text)); toast('Copied') }
    catch { toast('Could not copy. Long-press the text to select it.') }
  }
  const q = plainText(query).replace(/\s+/g, ' ').slice(0, 200)
  const body = plainText(text).slice(0, 1500)
  const ask = kind === 'question'
    ? `I'm preparing for GATE 2027 (CS and DA). Explain how to solve this question step by step in simple language, then give the answer and the common trap:\n\n${body}`
    : `I'm preparing for GATE 2027 (CS and DA). Explain this concept simply, like I'm 15, then with one worked example with numbers, and how GATE asks it:\n\n${body}`
  const enc = encodeURIComponent(ask)
  return (
    <div class="copysearch">
      <button class="link" onClick={copy}>Copy text</button>
      <a class="link" href={`https://www.google.com/search?q=${encodeURIComponent(q + ' GATE')}`} target="_blank" rel="noopener noreferrer">Google it</a>
      <a class="link" href={`https://chatgpt.com/?q=${enc}`} target="_blank" rel="noopener noreferrer">Ask ChatGPT</a>
      <a class="link" href={`https://claude.ai/new?q=${enc}`} target="_blank" rel="noopener noreferrer">Ask Claude</a>
    </div>
  )
}
