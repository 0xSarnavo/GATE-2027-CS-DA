import { getWeightage } from './api'
import { useLoad } from './ui'
import { usePrefs, setPrefs } from './store'
import { cx } from './util'

/** Average marks per paper from past papers, for the papers the user takes (Settings, My papers). */
export function useWeight() {
  const w = useLoad(() => getWeightage().catch(() => ({ CS: null, DA: null })), [])
  const { papers } = usePrefs()
  const want = papers === 'both' ? (['CS', 'DA'] as const) : ([papers] as const)
  /** marks per paper for one topic id (subject or chapter), per selected paper; null when unknown */
  const val = (id: string, root: boolean) => want.map((p) => { const d = w.data?.[p]; const v = d ? (root ? d.subjects[id] : d.chapters[id]?.avg_marks) : undefined; return [p, v] as const })
  /** a single number for sorting: the largest of the selected papers */
  const score = (id: string, root: boolean) => Math.max(0, ...val(id, root).map(([, v]) => v ?? 0))
  return { val, score, ready: !!w.data && (!!w.data.CS || !!w.data.DA), want, data: w.data }
}
type W = ReturnType<typeof useWeight>
const r1 = (n: number) => (Math.round(n * 10) / 10).toString()

export function WChip({ w, id, root }: { w: W; id: string; root: boolean }) {
  const v = w.val(id, root).filter(([, x]) => x !== undefined && x > 0)
  if (!v.length) return null
  const label = v.length === 1 ? `\u2248 ${r1(v[0][1]!)} marks/paper` : `\u2248 ${v.map(([p, x]) => `${r1(x!)} ${p}`).join(' \u00b7 ')} marks/paper`
  return <span class="wchip" title="Average marks per paper from past papers">{label}</span>
}

export function SortToggle() {
  const { sortW } = usePrefs()
  return <button class={cx('chip sm', sortW && 'on')} aria-pressed={sortW} onClick={() => setPrefs({ sortW: !sortW })}>Sort by weightage</button>
}

export function WFootnote({ w }: { w: W }) {
  if (!w.ready) return null
  const n = w.data
  return <p class="hint wfoot">Marks per paper are the average over past papers ({n?.CS ? `CS ${n.CS.n_papers} papers, 2017 to 2026` : ''}{n?.CS && n?.DA ? '; ' : ''}{n?.DA ? `DA ${n.DA.n_papers} papers, 2024 to 2026` : ''}). DA has only a few years of data so far, so treat it as an estimate.</p>
}
