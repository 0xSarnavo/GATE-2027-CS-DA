import { db } from "../db";
import { dehydrate, JSON_COLS, now, uuid } from "../util";
import { bind } from "../validate";

export interface TableDef {
  name: string;
  pk: string[];
  /** natural-key lookup: returns [where, params] or null */
  natural?: (r: any) => [string, any[]] | null;
  textId?: boolean; // generate uuid when id missing
}
const nn = (v: any) => (v === undefined ? null : v);
/** Order matters: parents first (import), reversed for deletes. */
export const TABLES: TableDef[] = [
  { name: "settings", pk: ["key"] },
  { name: "subjects", pk: ["id"] },
  { name: "topics", pk: ["id"], textId: true, natural: r => r.subject_id && r.name ? ["subject_id=? AND name=? AND deleted_at IS NULL", [r.subject_id, r.name]] : null },
  { name: "topic_progress", pk: ["topic_id"] },
  { name: "topic_notes", pk: ["topic_id"] },
  { name: "concept_mastery", pk: ["date", "topic_id", "atom_id"] },
  { name: "phases", pk: ["id"], textId: true },
  { name: "weeks", pk: ["id"], textId: true, natural: r => r.start_date ? ["start_date=?", [r.start_date]] : null },
  { name: "plan_days", pk: ["date"] },
  { name: "plan_tasks", pk: ["id"], textId: true },
  { name: "plan_revisions", pk: ["id"], textId: true },
  { name: "checkins", pk: ["date"] },
  { name: "study_minutes", pk: ["date", "subject_id", "source"] },
  { name: "active_time_batches", pk: ["id"] },
  { name: "questions", pk: ["id"], textId: true, natural: r => r.source === "official" && r.paper && r.year != null && r.session && r.q_no != null ? ["source='official' AND deleted_at IS NULL AND paper=? AND year=? AND session=? AND q_no=?", [r.paper, r.year, r.session, String(r.q_no)]] : null },
  { name: "question_topics", pk: ["question_id", "topic_id"] },
  { name: "mocks", pk: ["id"], textId: true },
  { name: "attempts", pk: ["id"], textId: true },
  { name: "mistakes", pk: ["id"], textId: true },
  { name: "doubts", pk: ["id"], textId: true },
  { name: "reports", pk: ["id"], textId: true },
  { name: "speed_drill_bests", pk: ["duration_s"] },
  { name: "cards", pk: ["id"], textId: true, natural: r => r.front ? ["front=? AND topic_id IS ? AND deleted_at IS NULL", [r.front, nn(r.topic_id)]] : null },
  { name: "card_reviews", pk: ["id"], textId: true },
  { name: "game_scores", pk: ["id"], textId: true },
  { name: "jobs", pk: ["id"], textId: true, natural: r => r.company ? ["company=? AND role IS ? AND date_applied IS ? AND deleted_at IS NULL", [r.company, nn(r.role), nn(r.date_applied)]] : null },
  { name: "videos", pk: ["id"], textId: true, natural: r => r.url ? ["url=? AND topic_id IS ? AND deleted_at IS NULL", [r.url, nn(r.topic_id)]] : null },
  { name: "video_concepts", pk: ["video_id", "topic_id", "atom_id"] },
  { name: "video_progress", pk: ["video_id"] },
  { name: "push_subscriptions", pk: ["endpoint"] },
  { name: "reminder_deliveries", pk: ["key"] },
];
export const TABLE_BY = new Map(TABLES.map(t => [t.name, t]));

const colCache = new Map<string, { name: string; type: string }[]>();
export function columns(table: string) {
  let c = colCache.get(table);
  if (!c) { c = (db.query(`SELECT name, type FROM pragma_table_info('${table}')`).all() as any[]); colCache.set(table, c); }
  return c;
}

/** Coerce a raw (possibly CSV/stringly) row to DB shape. Unknown keys dropped. */
export function shapeRow(table: string, raw: Record<string, any>): Record<string, any> {
  const cols = columns(table);
  const row: Record<string, any> = {};
  const src = dehydrate(table, raw);
  for (const c of cols) {
    let v = src[c.name];
    if (v === undefined) continue;
    if ((c.type === "INTEGER" || c.type === "REAL") && typeof v === "string") v = v.trim() === "" ? null : Number(v);
    if (typeof v === "number" && !isFinite(v)) v = null;
    if (v === "" && !["notes", "front", "back", "stem", "answer"].includes(c.name) && c.type === "TEXT" && /_on$|^date|_date$|^next_follow_up$|^deleted_at$/.test(c.name)) v = null;
    row[c.name] = bind(v);
  }
  return row;
}

export type UpsertResult = "created" | "updated" | "skipped" | "stale";
/**
 * Upsert by pk, else natural key. `lww`: when set (client_ts ISO), skip rows whose server updated_at is newer.
 */
export function upsertRow(table: string, raw: Record<string, any>, opts: { lww?: string; actor?: string; keepExistingId?: boolean } = {}): UpsertResult {
  const def = TABLE_BY.get(table)!;
  const row = shapeRow(table, raw);
  const cols = columns(table).map(c => c.name);
  if (def.textId && row.id == null) row.id = uuid();
  for (const k of def.pk) if (row[k] == null && !(def.textId && k === "id")) {
    // allow lookup via natural key when pk missing
    if (!def.natural) throw new Error(`${table}: missing ${k}`);
  }
  let existing: any = null;
  if (def.pk.every(k => row[k] != null)) existing = db.query(`SELECT * FROM ${table} WHERE ${def.pk.map(k => `${k}=?`).join(" AND ")}`).get(...def.pk.map(k => row[k]));
  if (!existing && def.natural) { const n = def.natural(row); if (n) existing = db.query(`SELECT * FROM ${table} WHERE ${n[0]}`).get(...n[1]); }
  if (existing) {
    for (const k of def.pk) row[k] = existing[k];
    if (opts.lww && existing.updated_at && existing.updated_at > opts.lww) return "stale";
    const set = Object.keys(row).filter(k => !def.pk.includes(k) && k !== "created_at" && k !== "updated_at" && k !== "created_by");
    const diff = set.filter(k => !((existing[k] ?? null) == (row[k] ?? null)));
    if (!diff.length) return "skipped";
    const sets = [...diff, ...(cols.includes("updated_at") ? ["updated_at"] : [])];
    db.run(`UPDATE ${table} SET ${sets.map(k => `${k}=?`).join(",")} WHERE ${def.pk.map(k => `${k}=?`).join(" AND ")}`,
      [...diff.map(k => row[k]), ...(cols.includes("updated_at") ? [now()] : []), ...def.pk.map(k => row[k])]);
    return "updated";
  }
  if (cols.includes("updated_at") && row.updated_at == null) row.updated_at = now();
  if (cols.includes("created_at") && row.created_at == null) row.created_at = now();
  if (cols.includes("created_by") && row.created_by == null) row.created_by = opts.actor ?? "import";
  const keys = Object.keys(row);
  db.run(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, keys.map(k => row[k]));
  return "created";
}

export const SNAPSHOT_TABLES = ["subjects", "topics", "topic_progress", "questions", "question_topics", "cards", "phases", "weeks", "plan_days", "plan_tasks", "videos", "video_progress", "settings", "checkins", "mistakes", "mocks", "jobs", "study_minutes"];
export const HAS_UPDATED_AT = (t: string) => columns(t).some(c => c.name === "updated_at");
export { JSON_COLS };

// ---- CSV
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(x => x !== "")) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some(x => x !== "")) rows.push(row);
  const head = (rows.shift() ?? []).map(h => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
const CSV_ALIASES: Record<string, Record<string, string>> = {
  mocks: { three_topics_to_revise: "topics_to_revise" },
  jobs: {},
};
export function csvToRows(table: string, text: string) {
  return parseCsv(text).map(r => {
    const o: Record<string, any> = {};
    for (const [k, v] of Object.entries(r)) o[CSV_ALIASES[table]?.[k] ?? k] = v;
    if (table === "mocks") {
      if (typeof o.topics_to_revise === "string") o.topics_to_revise = o.topics_to_revise ? o.topics_to_revise.split(/[;|]/).map((x: string) => x.trim()).filter(Boolean) : [];
      if (!o.date) o.date = undefined;
      o.paper = o.paper ? (/^(cs|da|ga)$/i.test(o.paper) ? o.paper.toUpperCase() : /sectional/i.test(o.paper) ? "sectional" : o.paper) : o.paper;
    }
    for (const k of Object.keys(o)) if (o[k] === "") delete o[k];
    return o;
  });
}
