import { ApiError } from "./errors";

export const now = () => new Date().toISOString();
const IST_MS = 330 * 60_000;
/** YYYY-MM-DD in IST for a Date or ISO string (default: now). */
export function istDate(d: Date | string = new Date()): string {
  const t = typeof d === "string" ? new Date(d) : d;
  return new Date(t.getTime() + IST_MS).toISOString().slice(0, 10);
}
/** FAKE_TODAY=YYYY-MM-DD pins 'today' for manual testing; ignored in production. */
export const todayIST = () => (process.env.FAKE_TODAY && process.env.NODE_ENV !== "production" ? process.env.FAKE_TODAY : istDate());
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
export const uuid = () => Bun.randomUUIDv7();
export function dateParam(v: string | undefined, name: string, dflt?: string): string {
  if (v === undefined || v === "") { if (dflt) return dflt; throw new ApiError(400, "validation", `${name} is required`); }
  if (!isDate(v)) throw new ApiError(400, "validation", `${name} must be YYYY-MM-DD`);
  return v;
}

export const JSON_COLS: Record<string, string[]> = {
  questions: ["options", "image_refs", "hints", "atoms"],
  topic_notes: ["atoms", "patterns", "traps"],
  weeks: ["macro_goals"],
  cards: ["tags"],
  mocks: ["topics_to_revise"],
  plan_revisions: ["diff"],
  import_runs: ["counts", "errors"],
};
/** Parse JSON columns of a DB row for API output. */
export function hydrate<T extends Record<string, any>>(table: string, row: T | null | undefined): T | null {
  if (!row) return null;
  const cols = JSON_COLS[table];
  if (!cols) return row;
  const out: any = { ...row };
  for (const c of cols) if (typeof out[c] === "string") { try { out[c] = JSON.parse(out[c]); } catch { /* keep */ } }
  return out;
}
/** Normalise API input for DB storage (stringify JSON columns). */
export function dehydrate(table: string, row: Record<string, any>): Record<string, any> {
  const cols = JSON_COLS[table];
  if (!cols) return row;
  const out = { ...row };
  for (const c of cols) if (out[c] !== undefined && out[c] !== null && typeof out[c] !== "string") out[c] = JSON.stringify(out[c]);
  return out;
}

export function paging(q: (k: string) => string | undefined, dflt = 100) {
  const limit = Math.min(1000, Math.max(1, Number(q("limit")) || dflt));
  const offset = Math.max(0, Number(q("cursor")) || 0);
  return { limit, offset };
}
export function page<T>(rows: T[], limit: number, offset: number) {
  const more = rows.length > limit;
  return { items: more ? rows.slice(0, limit) : rows, next: more ? String(offset + limit) : null };
}
export const round5 = (n: number) => Math.round(n / 5) * 5;
