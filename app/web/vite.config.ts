import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'

// Mock mode only: serve question images from ../data/img at /media/img/*
function mockMedia(): Plugin {
  return {
    name: 'mock-media',
    configureServer(server) {
      server.middlewares.use('/media/img', (req, res, next) => {
        const imgDir = path.resolve(process.env.CONTENT_DIR || path.resolve(__dirname, '../data'), 'img')
        const f = path.resolve(imgDir, decodeURIComponent((req.url || '').split('?')[0]).replace(/^\//, ''))
        if (f.startsWith(imgDir) && fs.existsSync(f)) {
          res.setHeader('Content-Type', f.endsWith('.webp') ? 'image/webp' : 'image/png')
          fs.createReadStream(f).pipe(res)
        } else next()
      })
    },
  }
}

function versionServiceWorker(): Plugin {
  return {
    name: 'version-service-worker',
    closeBundle() {
      const dist = path.resolve(__dirname, 'dist')
      const assets = fs.readdirSync(path.join(dist, 'assets')).sort().join('\n')
      const sw = path.join(dist, 'sw.js')
      const source = fs.readFileSync(sw, 'utf8')
      const version = createHash('sha256').update(assets).update(fs.readFileSync(path.join(dist, 'index.html'))).update(fs.readFileSync(path.join(dist, 'manifest.webmanifest'))).update(source).digest('hex').slice(0, 12)
      const extra = fs.readdirSync(path.join(dist, 'assets')).filter(name => /(\.(js|css)|nunito[^/]*\.woff2)$/.test(name)).map(name => '/assets/' + name)
      fs.writeFileSync(sw, source.replace('__BUILD_VERSION__', version).replace('const EXTRA = []', `const EXTRA = ${JSON.stringify(extra)}`))
    },
  }
}

// Keep only woff2 for KaTeX fonts (all target browsers support it); saves ~2/3 of font payload.
function katexWoff2Only(): Plugin {
  return {
    name: 'katex-woff2-only', enforce: 'pre',
    transform(code, id) {
      if (!id.includes('katex.min.css')) return
      return code.replace(/,url\([^)]*\.woff\) format\("woff"\)/g, '').replace(/,url\([^)]*\.ttf\) format\("truetype"\)/g, '')
    },
  }
}

// Human-written notes live in public/changelog.json (newest entry first under `entries`, or the flat v2 shape).
// Every build gets its own id (BUILD_ID, or package version + UTC timestamp + git hash) so a deploy is always
// detected as new, and dist/changelog.json is stamped with it.
const pkgVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version as string
const changelog = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'public/changelog.json'), 'utf8'))
const newest = Array.isArray(changelog.entries) ? changelog.entries[0] : changelog
const appVersion = pkgVersion
const gitHash = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'nogit' } })()
const buildId = process.env.BUILD_ID || `${pkgVersion}+${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}.${gitHash}`
function stampChangelog(): Plugin {
  return {
    name: 'stamp-changelog',
    closeBundle() {
      fs.writeFileSync(path.resolve(__dirname, 'dist/changelog.json'), JSON.stringify({ version: appVersion, build: buildId, date: newest.date, items: newest.items ?? [], entries: (changelog.entries ?? [newest]).slice(0, 5) }, null, 2))
    },
  }
}
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion), __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [katexWoff2Only(), versionServiceWorker(), stampChangelog(), preact(), ...(process.env.VITE_MOCK ? [mockMedia()] : [])],
  server: {
    host: true,
    fs: { allow: ['..'] },
    proxy: process.env.VITE_MOCK ? {} : {
      '/api': 'http://localhost:3000',
      '/media': 'http://localhost:3000',
    },
  },
  build: { target: 'es2020', chunkSizeWarningLimit: 700 },
})
