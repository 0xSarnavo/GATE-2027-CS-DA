const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Minimal markdown (bold, italic, code, lists, paragraphs) + KaTeX for $...$ and $$...$$. HTML is escaped. */
export function renderMd(src: string, k: any): string {
  const math: string[] = [], code: string[] = []
  src = src.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, c) => { code.push(`<pre>${esc(c.replace(/\n$/, ''))}</pre>`); return `\n\n\u0001${code.length - 1}\u0001\n\n` })
  let t = src.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (_m, d, i) => {
    const tex = (d ?? i).trim(), display = d !== undefined
    let h: string
    try { h = k ? k.renderToString(tex, { displayMode: display, throwOnError: false }) : '<span class="math-pending" aria-label="Loading formula">…</span>' } catch (e) { console.error('katex fail', tex, e); h = '<span aria-label="Formula unavailable">…</span>' }
    math.push(h); return `\u0000${math.length - 1}\u0000`
  })
  t = esc(t)
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*((?:(?!\*\*).)+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>').replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:]|$)/g, '$1<i>$2</i>')
  const blocks = t.split(/\n{2,}/).map((b) => {
    b = b.trim()
    const lines = b.split('\n')
    if (/^\u0001\d+\u0001$/.test(b)) return b
    if (/^-{3,}$/.test(b)) return '<hr>'
    const h = b.match(/^(#{1,4})\s+(.+)$/)
    if (h && lines.length === 1) return `<h${h[1].length + 2}>${h[2]}</h${h[1].length + 2}>`
    if (lines.length > 1 && lines.every((l) => l.includes('|'))) {
      const rows = lines.filter((l) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l)).map((l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()))
      const head = /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[1] ?? '')
      return `<table>${rows.map((r, i) => `<tr>${r.map((c) => `<${head && i === 0 ? 'th' : 'td'}>${c}</${head && i === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>`
    }
    if (lines.every((l) => /^\s*([-*]|\d+[.)])\s+/.test(l))) {
      const ol = /^\s*\d/.test(lines[0])
      return `<${ol ? 'ol' : 'ul'}>${lines.map((l) => `<li>${l.replace(/^\s*([-*]|\d+[.)])\s+/, '')}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`
    }
    return `<p>${lines.join('<br>')}</p>`
  })
  return blocks.join('').replace(/\u0001(\d+)\u0001/g, (_m, n) => code[+n]).replace(/\u0000(\d+)\u0000/g, (_m, n) => math[+n])
}
