// Lint one v2.2 explainer file: required fields, scene validity, bounds, label collisions.
// Usage (from app/): bun tools/check_explainer.ts data/explainers/<topic>.json
// Exit code 1 if there are errors. Warnings are for a human to judge.
import { validateScene } from '../web/src/anim/validate.ts'
import { stateAt } from '../web/src/anim/engine.ts'

const file = process.argv[2]
if (!file) { console.error('usage: bun tools/check_explainer.ts <explainer.json>'); process.exit(2) }
const d = await Bun.file(file).json()
const errors: string[] = [], warnings: string[] = []
const err = (m: string) => errors.push(m), warn = (m: string) => warnings.push(m)
const empty = (v: any) => v == null || v === '' || (Array.isArray(v) && v.length === 0)

const note = d.chapter_note ?? {}
for (const k of ['about', 'concept_map', 'gate_patterns', 'simple']) if (empty(note[k])) err(`chapter_note.${k} missing`)

const scenes: any[] = Array.isArray(d.scenes) ? d.scenes : []
const byId = new Map<string, any>()
for (const s of scenes) { if (byId.has(s.id)) err(`duplicate scene id ${s.id}`); byId.set(s.id, s) }

const used = new Map<string, string[]>()
for (const [i, c] of (d.cards ?? []).entries()) {
  const tag = `card ${i + 1} (${c.atom_id ?? c.title})`
  for (const k of ['simple', 'idea', 'definition', 'intuition_full', 'why', 'mistake', 'what', 'what_full', 'why_full', 'trap'])
    if (empty(c[k])) err(`${tag}: ${k} missing`)
  for (const k of ['how', 'edge_cases', 'connections']) if (!Array.isArray(c[k]) || !c[k].length) err(`${tag}: ${k} must be a non-empty array`)
  const checks = Array.isArray(c.check) ? c.check : c.check ? [c.check] : []
  if (!checks.length || checks.some((q: any) => empty(q.q) || empty(q.a))) err(`${tag}: check[] needs q and a`)
  const ex = Array.isArray(c.examples) ? c.examples : []
  const levels = ex.map((e: any) => e.level)
  if (!levels.includes('basic') || !levels.includes('gate')) err(`${tag}: examples need a basic and a gate level`)
  ex.forEach((e: any, j: number) => { if (empty(e.setup) || empty(e.steps) || empty(e.answer)) err(`${tag}: examples[${j}] needs setup, steps, answer`) })
  if (!c.scene) { err(`${tag}: no scene`); continue }
  const s = byId.get(c.scene)
  if (!s) { err(`${tag}: scene ${c.scene} not in scenes[]`); continue }
  used.set(c.scene, [...(used.get(c.scene) ?? []), tag])
  const n0 = ex[0]?.steps?.length ?? 0
  if (n0 && Math.abs(s.steps.length - n0) > 2) warn(`${tag}: scene has ${s.steps.length} steps, examples[0] has ${n0} (step-sync)`)
}
for (const [id, tags] of used) if (tags.length > 1) warn(`scene ${id} shared by ${tags.join(', ')}; fine only if it animates each card's examples[0]`)
for (const s of scenes) if (!used.has(s.id)) warn(`scene ${s.id} not used by any card`)

// Rough bounding boxes. Text width is estimated from character count.
const textW = (t: string, size: number) => Math.max(...String(t).split('\n').map((l) => l.length)) * size * 0.56
function box(o: any, at: { x: number; y: number }, props: any): [number, number, number, number] | null {
  const x = at.x, y = at.y
  switch (o.kind) {
    case 'node': { const r = o.r ?? 20; return [x - r, y - r, x + r, y + r] }
    case 'box': return [x, y, x + o.w, y + o.h]
    case 'circle': return [o.cx - o.r, o.cy - o.r, o.cx + o.r, o.cy + o.r]
    case 'text': {
      // render.tsx Multi: font >= ~12, lines centred vertically on y
      const t = props?.text ?? o.text, size = Math.max(o.size ?? 14, 12), w = textW(t, size), lines = String(t).split('\n').length
      const x0 = o.anchor === 'start' ? x : o.anchor === 'end' ? x - w : x - w / 2, top = y - ((lines - 1) * size * 1.25) / 2 - size * 0.7
      return [x0, top, x0 + w, top + size * 1.25 * lines]
    }
    case 'math': { const w = o.w ?? 220, h = o.h ?? 36, x0 = o.anchor === 'start' ? x : o.anchor === 'end' ? x - w : x - w / 2; return [x0, y - h / 2, x0 + w, y + h / 2] }
    case 'array': {
      const n = Math.max(o.slots ?? 0, (props?.cells ?? o.cells ?? []).length), cw = o.cw ?? 36, ch = o.ch ?? 36, dir = o.dir ?? 'right'
      if (dir === 'right') return [x, y, x + n * cw, y + ch + ((o.indices ?? true) ? 18 : 0)]
      return dir === 'down' ? [x, y, x + cw, y + n * ch] : [x, y - n * ch, x + cw, y]
    }
    case 'grid': { const cw = o.cw ?? 40, ch = o.ch ?? 40; return [x - (o.rowLabels ? 30 : 0), y - (o.colTitle ? 34 : o.colLabels ? 18 : 0), x + o.cols * cw, y + o.rows * ch] }
    case 'matrix': { const v = props?.values ?? o.values ?? [[]]; return [x, y, x + (v[0]?.length ?? 0) * (o.cw ?? 34), y + v.length * (o.ch ?? 30)] }
    case 'bar': return [x, y, x + (o.w ?? 240), y + (o.h ?? 100) + (o.labels ? 18 : 0)]
    case 'axis': { const u = o.unit ?? 40, [xa, xb] = o.xr ?? [-3, 3], [ya, yb] = o.yr ?? [-3, 3]; return [x + xa * u, y - yb * u, x + xb * u, y - ya * u] }
    default: return null
  }
}

for (const s of scenes) {
  const v = validateScene(s)
  v.errors.forEach((e) => err(`scene ${s.id}: ${e}`))
  v.warnings.forEach((w) => warn(`scene ${s.id}: ${w}`))
  if (!v.ok) continue
  const kinds = new Set(s.objects.map((o: any) => o.kind))
  if ([...kinds].every((k) => k === 'text' || k === 'math')) warn(`scene ${s.id}: text/math only; looks like a template scene`)
  const [vx, vy, vw, vh] = s.viewBox ?? [0, 0, 360, 240]
  const objs = new Map(s.objects.map((o: any) => [o.id, o]))
  const seenOut = new Set<string>(), seenClash = new Set<string>()
  for (let k = 0; k < s.steps.length; k++) {
    const st: any = stateAt(s, k)
    const texts: [string, number[]][] = []
    for (const id of st.vis) {
      const o: any = objs.get(id); if (!o) continue
      const b = box(o, st.num[id] ?? { x: o.x ?? 0, y: o.y ?? 0 }, st.props[id])
      if (!b) continue
      if ((b[0] < vx - 2 || b[1] < vy - 2 || b[2] > vx + vw + 2 || b[3] > vy + vh + 2) && !seenOut.has(id)) {
        seenOut.add(id); warn(`scene ${s.id} step ${k + 1}: ${id} (${o.kind}) ~[${b.map(Math.round)}] outside viewBox [${vx},${vy},${vw},${vh}]`)
      }
      if (o.kind === 'text') texts.push([id, b])
      if (o.kind === 'bar') {
        const values: number[] = st.props[id]?.values ?? o.values
        const hideZero = st.props[id]?.hideZero ?? o.hideZero
        const h = o.h ?? 100, bw = (o.w ?? 240) / values.length, max = o.max ?? Math.max(...values, 1e-9)
        values.forEach((v, i) => {
          if (hideZero && v === 0) return
          const label = String(+v.toFixed(3)), cx = b[0] + (i + 0.5) * bw, cy = b[1] + h - (v / max) * h - 8
          const halfWidth = textW(label, 12) / 2
          texts.push([`${id}.value[${i}]`, [cx - halfWidth, cy - 6, cx + halfWidth, cy + 6]])
        })
      }
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const [a, A] = texts[i], [b, B] = texts[j], key = a + '|' + b
      const gapX = Math.max(A[0], B[0]) - Math.min(A[2], B[2]), gapY = Math.max(A[1], B[1]) - Math.min(A[3], B[3])
      const sameBar = a.includes('.value[') && a.split('.value[')[0] === b.split('.value[')[0]
      if (gapX < (sameBar ? 0 : 10) && gapY < 0 && !seenClash.has(key)) { seenClash.add(key); warn(`scene ${s.id} step ${k + 1}: text ${a} and ${b} overlap or sit <10px apart`) }
    }
  }
}

const nc = d.cards?.length ?? 0
console.log(`${d.topic_id}: ${nc} cards, ${scenes.length} scenes, ${errors.length} errors, ${warnings.length} warnings`)
errors.forEach((e) => console.log('  ERROR ' + e))
warnings.forEach((w) => console.log('  warn  ' + w))
process.exit(errors.length ? 1 : 0)
