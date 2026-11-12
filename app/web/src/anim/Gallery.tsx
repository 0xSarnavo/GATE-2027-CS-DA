import { useEffect, useState } from 'preact/hooks'
import { ExplainerCards, type Mode } from './Cards'
import { AnimPlayer, SceneErrors } from './Player'
import { validateScene } from './validate'
import type { ExplainerFile, Scene } from './types'

// Dev only: every JSON in data/explainers/_samples, loaded on demand.
const files = import.meta.glob('../../../data/explainers/_samples/*.json', { import: 'default' }) as Record<string, () => Promise<any>>
const names = Object.keys(files).sort()
const short = (p: string) => p.split('/').pop()!.replace('.json', '')

export function AnimGallery() {
  const [sel, setSel] = useState(names.find((n) => n.includes('.scene.')) ?? names[0])
  const [data, setData] = useState<any>(null)
  const [mode, setMode] = useState<Mode>('focus')
  const [raw, setRaw] = useState('')
  useEffect(() => { setData(null); if (sel) files[sel]().then(setData) }, [sel])
  let pasted: any = null, parseErr = ''
  if (raw.trim()) try { pasted = JSON.parse(raw) } catch (e) { parseErr = String(e) }
  const isExplainer = data && Array.isArray(data.cards)
  return <div style={{ padding: 16, maxWidth: 680, margin: '0 auto' }}>
    <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>Animation gallery</h1>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }} role="group" aria-label="Samples">
      {names.map((n) => <button key={n} type="button" class="ab" style={{ flex: '0 0 auto', minHeight: 36, fontSize: 13, padding: '0 10px', margin: 2 }} aria-pressed={n === sel} onClick={() => setSel(n)}>{short(n)}</button>)}
    </div>
    {isExplainer && <label style={{ display: 'block', marginBottom: 12, fontSize: 14 }}><input type="checkbox" checked={mode === 'full'} onChange={(e) => setMode((e.target as HTMLInputElement).checked ? 'full' : 'focus')} /> Full mode (all cards)</label>}
    {data && (isExplainer ? <ExplainerCards file={data as ExplainerFile} mode={mode} onTry={(t) => alert('Try: ' + t.label)} /> : <AnimPlayer key={sel} scene={data as Scene} />)}
    <details style={{ marginTop: 24 }}>
      <summary style={{ cursor: 'pointer', minHeight: 32 }}>Paste a scene JSON</summary>
      <textarea aria-label="Scene JSON" value={raw} onInput={(e) => setRaw((e.target as HTMLTextAreaElement).value)} rows={8} style={{ width: '100%', font: '12px ui-monospace, monospace', marginTop: 8 }} />
      {parseErr && <SceneErrors errors={[parseErr]} />}
      {pasted && <>
        {validateScene(pasted).warnings.map((w, i) => <p key={i} style={{ fontSize: 13, color: 'var(--muted)' }}>{w}</p>)}
        <AnimPlayer scene={pasted} />
      </>}
    </details>
  </div>
}
