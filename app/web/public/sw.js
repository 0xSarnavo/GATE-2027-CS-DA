// Hand-written service worker. Vite stamps the cache version and lazy screen assets;
// index.html supplies the entry assets at install time.
const V = '__BUILD_VERSION__'
const SHELL = 'gate-shell-' + V
const RUNTIME = 'gate-runtime-' + V
const DATA = 'gate-data-' + V
const KEEP = [SHELL, RUNTIME, DATA]
const EXTRA = [] // Vite fills this with lazy screen JS/CSS at build time

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL)
    const res = await fetch('/index.html', { cache: 'no-cache' })
    const html = await res.clone().text()
    const urls = new Set(['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png', '/icons/icon.svg', ...EXTRA])
    for (const m of html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)) urls.add(m[1])
    await cache.put('/index.html', res)
    await Promise.all([...urls].filter((u) => u !== '/index.html').map((u) => cache.add(u).catch(() => {})))
  })())
  // never skipWaiting automatically: the UI asks (so a quiz is never reloaded mid-question)
})

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting() })

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k)
    await self.clients.claim()
  })())
})

const DATA_PATHS = [/^\/api\/(questions|topics|videos|cards|settings)(\/|\?|$)/]

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  // navigations: network first, fall back to cached shell
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')))
    return
  }
  // immutable: hashed assets and question images -> cache first
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(cacheFirst(req, url.pathname.startsWith('/media/') ? RUNTIME : SHELL))
    return
  }
  // question/topic/card data: network first, cached fallback
  if (DATA_PATHS.some((r) => r.test(url.pathname + url.search))) {
    e.respondWith(networkFirst(req, DATA))
    return
  }
  if (url.pathname === '/manifest.webmanifest') e.respondWith(cacheFirst(req, SHELL))
})

async function cacheFirst(req, name) {
  const c = await caches.open(name)
  const hit = await c.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) c.put(req, res.clone())
  return res
}
async function networkFirst(req, name) {
  const c = await caches.open(name)
  try {
    const res = await fetch(req)
    if (res.ok) c.put(req, res.clone())
    return res
  } catch (err) {
    const hit = await c.match(req)
    if (hit) return hit
    throw err
  }
}

// Background Sync where supported (not iOS): ask clients to flush their outbox
self.addEventListener('sync', (e) => {
  if (e.tag === 'flush-outbox') {
    e.waitUntil(self.clients.matchAll().then((cs) => cs.forEach((c) => c.postMessage('flush-outbox'))))
  }
})

self.addEventListener('push', (e) => {
  let data = {}; try { data = e.data?.json() || {} } catch {}
  e.waitUntil(self.registration.showNotification(data.title || 'GATE 27', { body: data.body || '', icon: '/icons/icon-192.png', data: { url: data.url || '/#/today' } }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(self.clients.openWindow(e.notification.data?.url || '/#/today'))
})
