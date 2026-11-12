/** Grade an answer. MCQ exact key; MSQ exact set; NAT numeric vs value or lo..hi range(s) joined by '|'. Returns null if question has no answer key. */
export function grade(q: { type: string; answer: string }, given: unknown): boolean | null {
  const key = (q.answer ?? "").trim();
  if (!key) return null;
  if (given === null || given === undefined) return false;
  const g = String(given).trim();
  if (g === "") return false;
  if (q.type === "NAT") {
    const x = Number(g.replace(/,/g, ""));
    if (!isFinite(x)) return false;
    return key.split("|").some(part => {
      const m = part.trim().match(/^(-?[\d.eE+-]+)\s*\.\.\s*(-?[\d.eE+-]+)$/);
      if (m) { const lo = Number(m[1]), hi = Number(m[2]); return x >= Math.min(lo, hi) - 1e-9 && x <= Math.max(lo, hi) + 1e-9; }
      const v = Number(part.trim());
      return isFinite(v) && Math.abs(x - v) <= Math.max(1e-6, Math.abs(v) * 1e-3);
    });
  }
  const norm = (s: string) => s.toUpperCase().split(/[\s,]+/).filter(Boolean).sort().join(",");
  if (key.toUpperCase() === "MTA") return true; // marks to all
  // several accepted alternatives are stored joined by '|', e.g. 'A,C,D|C,D' or 'C|D'
  return key.split("|").some(alt => norm(g) === norm(alt));
}
