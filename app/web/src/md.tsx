import { useEffect, useState } from 'preact/hooks'
import { usePrefs } from './store'
import { renderMd } from './md-render'
export { renderMd } from './md-render'

let katexP: Promise<any> | null = null
let katexMod: any = null
export function loadKatex() {
  katexP ??= import('./katex-loader').then((m) => (katexMod = m.default))
  return katexP
}
/** Focus/Full layers: base text is Focus; `full` is the detailed version. Global pref picks the default; "Show more" toggles per section. */
export function Layered({ focus, full, class: c = '' }: { focus?: string | null; full?: string | null; class?: string }) {
  const { detail } = usePrefs()
  const [more, setMore] = useState<boolean | null>(null)
  const hasBoth = !!focus && !!full && full.trim() !== focus.trim()
  const showFull = more ?? (detail === 'full')
  const text = hasBoth ? (showFull ? full : focus) : (focus || full)
  if (!text) return null
  return (
    <div class={'layered ' + (showFull && hasBoth ? 'is-full' : 'is-focus')}>
      <Md text={text} class={c} />
      {hasBoth && <button class="more" aria-expanded={showFull} onClick={() => setMore(!showFull)}>{showFull ? 'Show less' : 'Show more'}</button>}
    </div>
  )
}

export function Md({ text, class: c = '' }: { text?: string; class?: string }) {
  const [k, setK] = useState<any>(katexMod)
  const hasMath = !!text && text.includes('$')
  useEffect(() => { if (hasMath && !k) loadKatex().then(setK) }, [hasMath, k])
  if (!text) return null
  return <div class={'md ' + c} dangerouslySetInnerHTML={{ __html: renderMd(text, k) }} />
}
