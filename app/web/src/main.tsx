import { render } from 'preact'
import { Suspense } from 'preact/compat'
import { useEffect, useState } from 'preact/hooks'
import './styles.css'
import { me, login, locallySignedOut, setUnauthHandler, startSync, ApiError } from './api'
import { useRoute, go, setNavToast } from './router'
import { Header, TabBar, Toasts, Field, toast, Logo } from './ui'
import { UpdateCard, UpdatedNote } from './update'
import { setSync, useSync, applyTheme } from './store'
import { screens, moduleEnabled, refreshModules, setModules, tabs, useModules } from './modules'
import { getOnboardingStatus } from './api'
import Onboarding from './modules/planner/Onboarding'
import { VideoPlayer } from './modules/learn/VideoPlayer'
import { startActiveTime } from './active-time'

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const submit = async (e: Event) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { await login(pw.trim().replace(/^[`'"]+|[`'"]+$/g, '')); onDone() }
    catch (x) { setErr(x instanceof ApiError && x.status === 429 ? 'Too many attempts. Wait a few minutes, then try again.' : x instanceof ApiError ? 'That password did not work. Check it and try again.' : "Can't reach the server. Check your connection and try again.") }
    setBusy(false)
  }
  return (
    <main class="login">
      <form onSubmit={submit}>
        <Logo />
        <h1>GATE 27</h1>
        <p class="muted">GATE 2027 prep. One day at a time.</p>
        <Field label="Password">
          <input type="password" autoFocus autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck={false} aria-invalid={!!err} value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
        </Field>
        {err && <div class="err" role="alert">{err}</div>}
        <button class="btn primary block" disabled={busy || !pw}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </main>
  )
}

const FULLSCREEN = new Set(['q', 'mistakes'])
const fullscreen = (tab: string, rest: string[]) => FULLSCREEN.has(tab) || (tab === 'test' && ['run', 'result'].includes(rest[0])) || (tab === 'cards' && (rest[0] === 'review' || rest[0] === 'game')) || (tab === 'learn' && rest.length >= 2 && !['course', 'sheet'].includes(rest[0]))

function Shell() {
  const r = useRoute()
  const [first, ...rest] = r.parts
  const modules = useModules()
  const firstTab = tabs.find(t => modules.some(m => m.id === t.module && m.enabled))?.id || 'settings'
  const tab = first || firstTab
  const hideTabs = fullscreen(tab, rest)
  useEffect(() => { if (!first) go(firstTab, true)
    if (tab === 'plan' && rest[0] === 'calendar') go('calendar', true)
    // a route change must never leave the page scroll-locked (nothing locks body today; this is the safety net)
    for (const el of [document.documentElement, document.body]) { el.style.removeProperty('overflow'); el.style.removeProperty('position'); el.style.removeProperty('top') }
    // per route: update the tab title, and park focus on <main> so keyboard/screen-reader users start at the content
    setTimeout(() => { const h = document.querySelector('.hdr h1, .qbar h1, .r-title')?.textContent; document.title = h ? `${h} - GATE 27` : 'GATE 27'; const m = document.querySelector('main'); if (m) { m.tabIndex = -1; m.id = 'main' } }, 60)
  }, [r.raw])
  const s = useSync()
  const screenKey = tab === 'plan' && rest[0] === 'calendar' ? 'calendar' : tab === 'practice' && rest[0] ? 'topic' : tab
  const Screen = (screens as Record<string, { module: string; component: any }>)[screenKey]?.component
  const required = (screens as Record<string, { module: string; component: any }>)[screenKey]?.module
  const body = !Screen || (required && !moduleEnabled(required))
    ? <><Header title="Not found" onBack /><main class="page"><p class="empty">This screen is unavailable.</p></main></>
    : screenKey === 'calendar' ? <Screen parts={rest} query={r.query} />
    : tab === 'plan' ? <Screen date={rest[0]} />
    : tab === 'today' ? <Screen query={r.query} />
    : tab === 'search' ? <Screen query={r.query} />
    : tab === 'practice' && rest[0] ? <Screen id={rest[0]} query={r.query} />
    : tab === 'q' ? <Screen id={rest[0]} query={r.query} />
    : tab === 'cards' || tab === 'learn' || tab === 'test' ? <Screen parts={rest} query={r.query} />
    : tab === 'insights' ? <Screen parts={rest} />
    : tab === 'log' ? <Screen tab={rest[0]} />
    : tab === 'dev' ? <><Header title="Animation gallery" onBack /><Screen /></>
    : <Screen />
  return (
    <div class={'app' + (hideTabs ? ' notabs' : '')}>
      <a class="skip" href="#/" onClick={(e) => { e.preventDefault(); (document.querySelector('main') as HTMLElement | null)?.focus() }}>Skip to content</a>
      <Suspense fallback={<><Header title="Loading" /><main class="page"><div class="skeleton" /><div class="skeleton" /></main></>}>{body}</Suspense>
      <TabBar active={tab === 'calendar' ? 'plan' : tab} hidden={hideTabs} />
      <div class="toast-slot"><UpdateCard /><UpdatedNote /></div>
      <Toasts />
      <VideoPlayer />
    </div>
  )
}

function App() {
  const [st, setSt] = useState<'boot' | 'login' | 'setup' | 'ready'>('boot')
  const enter = async () => { await refreshModules(); const status = await getOnboardingStatus(); setSt(status.needs_setup ? 'setup' : 'ready') }
  useEffect(() => {
    setUnauthHandler(() => setSt('login'))
    if (locallySignedOut()) { setSt('login'); return }
    me().then(enter).catch(async (e) => {
      if (e instanceof ApiError && e.status === 401) { setSt('login'); return }
      try { await refreshModules(); const status = await getOnboardingStatus(); setSt(status.needs_setup ? 'setup' : 'ready') }
      catch { setModules(['planner','practice','learn','review','mocks','habits'].map(id => ({ id, available: true, enabled: true }))); setSt('ready') }
    })
  }, [])
  useEffect(() => { if (st === 'ready') { startSync(); startActiveTime() } }, [st])
  if (st === 'boot') return <div class="boot"><div class="skeleton" aria-label="Loading app" /></div>
  if (st === 'login') return <Login onDone={() => { enter().catch(() => setSt('ready')) }} />
  if (st === 'setup') return <Onboarding done={() => setSt('ready')} />
  return <Shell />
}

applyTheme()
// keyboard: lift fixed bars above it and hide the tab bar while typing; Android/iOS differ on resizing, so measure
if (window.visualViewport) {
  const vv = window.visualViewport, root = document.documentElement
  const sync = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    const active = document.activeElement as HTMLElement | null
    const typing = active?.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select') ?? false
    root.style.setProperty('--kb', kb + 'px'); root.style.setProperty('--vvh', Math.round(vv.height) + 'px')
    root.classList.toggle('kb-open', kb > 120 || (typing && vv.height < screen.height * .75))
  }
  vv.addEventListener('resize', sync); vv.addEventListener('scroll', sync)
  addEventListener('focusin', sync); addEventListener('focusout', () => setTimeout(sync, 0))
  sync()
}
setNavToast((m) => toast(m))
render(<App />, document.getElementById('app')!)

if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null)
    if (!reg) return
    const watch = (w: ServiceWorker | null) => w?.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) setSync({ updateReady: true })
    })
    if (reg.waiting && navigator.serviceWorker.controller) setSync({ updateReady: true })
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}) })
    reg.addEventListener('updatefound', () => watch(reg.installing))
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload() } })
  })
}
void toast
