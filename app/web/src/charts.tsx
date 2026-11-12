// Hand-rolled SVG charts. Colors come from CSS variables.
export function PairBars({ data }: { data: { label: string; planned: number; done: number }[] }) {
  if (!data.length) return null
  const W = 320, H = 150, P = { l: 30, r: 6, t: 8, b: 22 }
  const max = Math.max(60, ...data.flatMap((d) => [d.planned, d.done]))
  const cw = (W - P.l - P.r) / data.length, bw = Math.min(14, cw / 2.6)
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / max)
  const ticks = [0, 0.5, 1].map((f) => Math.round((max * f) / 60))
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Hours planned versus done per week">
      {ticks.map((h) => <g><line x1={P.l} x2={W - P.r} y1={y(h * 60)} y2={y(h * 60)} class="grid" /><text x={P.l - 4} y={y(h * 60) + 3} class="ax" text-anchor="end">{h}h</text></g>)}
      {data.map((d, i) => {
        const x = P.l + cw * i + cw / 2
        return (
          <g>
            <rect x={x - bw - 1} y={y(d.planned)} width={bw} height={H - P.b - y(d.planned)} rx="2" class="b-plan" />
            <rect x={x + 1} y={y(d.done)} width={bw} height={H - P.b - y(d.done)} rx="2" class="b-done" />
            <text x={x} y={H - 7} class="ax" text-anchor="middle">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function Lines({ series, yMax = 100 }: { series: { name: string; cls: string; pts: number[] }[]; yMax?: number }) {
  const n = Math.max(...series.map((s) => s.pts.length), 0)
  if (n < 1) return null
  const W = 320, H = 140, P = { l: 28, r: 10, t: 8, b: 18 }
  const x = (i: number) => P.l + (n === 1 ? (W - P.l - P.r) / 2 : ((W - P.l - P.r) * i) / (n - 1))
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - Math.max(0, v) / yMax)
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mock score trend">
      {[0, 0.5, 1].map((f) => <g><line x1={P.l} x2={W - P.r} y1={y(yMax * f)} y2={y(yMax * f)} class="grid" /><text x={P.l - 4} y={y(yMax * f) + 3} class="ax" text-anchor="end">{Math.round(yMax * f)}</text></g>)}
      {series.map((s) => (
        <g class={s.cls}>
          <polyline fill="none" class="ln" points={s.pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          {s.pts.map((v, i) => <circle cx={x(i)} cy={y(v)} r="3.5" class="pt" />)}
        </g>
      ))}
    </svg>
  )
}

export function HBars({ rows }: { rows: { label: string; pct: number; note?: string }[] }) {
  return (
    <ul class="hbars">
      {rows.map((r) => (
        <li><span class="l">{r.label}</span><span class="t"><i class={r.pct >= 0.7 ? 'good' : r.pct >= 0.4 ? 'mid' : 'bad'} style={{ width: Math.round(r.pct * 100) + '%' }} /></span><span class="v">{Math.round(r.pct * 100)}%{r.note ? <small> {r.note}</small> : null}</span></li>
      ))}
    </ul>
  )
}
