import { Hono } from "hono";
import { db } from "../db";
import type { Env } from "../auth";
import { ApiError } from "../errors";
import { parse, readJson } from "../validate";
import { hydrate, now, istDate } from "../util";
import { sweepAutoTasks } from '../modules/planner/auto';
import { HAS_UPDATED_AT, SNAPSHOT_TABLES, TABLE_BY, columns, upsertRow } from "../lib/importer";
import { completeTask, createAttempt, recomputeTaskMinutes, reviewCard, reviewMistake } from "../lib/services";
import { ATTEMPT } from "../modules/practice/questions";
import { saveCheckin } from "../modules/habits/routes";

const NO_UPDATED = ["subjects", "question_topics"]; // sent in full on every pull
const PULLABLE = [...SNAPSHOT_TABLES, "attempts", "card_reviews", "game_scores"];
const SOFT = (t: string) => columns(t).some(c => c.name === "deleted_at");
const GENERIC = ["topic_progress", "mocks", "jobs", "cards", "videos", "game_scores"];
const PSEUDO = ["attempts", "card_reviews", "mistake_reviews", "plan_tasks", "checkins"];
export const PUSH_TABLES = [...GENERIC, ...PSEUDO];

function applyOp(op: any, actor: string): void {
  const { table, data } = op;
  const ts: string = op.client_ts && !isNaN(Date.parse(op.client_ts)) ? new Date(op.client_ts).toISOString() : now();
  if (!PUSH_TABLES.includes(table)) throw new ApiError(422, "validation", `table ${table} is not writable via sync`);
  if (op.op !== "upsert" && op.op !== "delete") throw new ApiError(422, "validation", "op must be upsert|delete");
  if (!data || typeof data !== "object") throw new ApiError(422, "validation", "data is required");

  if (table === "attempts") {
    if (op.op === "delete") throw new ApiError(422, "validation", "attempts cannot be deleted");
    const p = parse({ ...data, id: data.id ?? op.id, at: data.at ?? ts }, ATTEMPT);
    createAttempt(p, actor as any); return;
  }
  if (table === "card_reviews") {
    if (op.op === "delete") throw new ApiError(422, "validation", "card_reviews cannot be deleted");
    reviewCard(data.card_id, { grade: data.grade, correct: data.correct, time_ms: data.time_ms, mode: data.mode, at: data.at ?? ts, review_id: data.id ?? op.id }); return;
  }
  if (table === "mistake_reviews") { reviewMistake(data.mistake_id, !!data.correct, data.at ?? ts); return; }
  if (table === "checkins") {
    if (typeof data.date !== "string") throw new ApiError(422, "validation", "data.date required");
    const ex = db.query("SELECT updated_at FROM checkins WHERE date=?").get(data.date) as any;
    if (ex && ex.updated_at > ts) throw new ApiError(409, "stale", "server row is newer");
    saveCheckin(data.date, data); return;
  }
  if (table === "plan_tasks") {
    const id = data.id ?? op.id;
    const ex = db.query("SELECT * FROM plan_tasks WHERE id=? AND deleted_at IS NULL").get(id) as any;
    if (!ex) throw new ApiError(404, "not_found", `task ${id} not found (create tasks via POST /api/plan/tasks)`);
    if (op.op === "delete") { if (ex.updated_at > ts) throw new ApiError(409, "stale", "server row is newer"); db.run("UPDATE plan_tasks SET deleted_at=?, updated_at=? WHERE id=?", [now(), now(), id]); recomputeTaskMinutes(ex.date); return; }
    const wantsDone = data.status === "done";
    if (ex.updated_at > ts && !(wantsDone && ex.status !== "done")) throw new ApiError(409, "stale", "server row is newer");
    const allowed: Record<string, any> = {};
    for (const k of ["status", "done_minutes", "est_minutes", "title", "priority", "sort", "time_block"]) if (data[k] !== undefined) allowed[k] = data[k];
    if (ex.status === "done" && allowed.status && allowed.status !== "done") delete allowed.status; // done beats everything
    if (allowed.status === "done" && ex.status !== "done") { completeTask(id, allowed.done_minutes ?? undefined); delete allowed.status; delete allowed.done_minutes; }
    const keys = Object.keys(allowed);
    if (keys.length) { db.run(`UPDATE plan_tasks SET ${keys.map(k => `${k}=?`).join(",")}, updated_at=? WHERE id=?`, [...keys.map(k => allowed[k]), now(), id]); recomputeTaskMinutes(ex.date); }
    return;
  }
  // generic LWW tables
  const def = TABLE_BY.get(table)!;
  const key = def.pk[0]!;
  const row = { ...data, [key]: data[key] ?? op.id };
  if (op.op === "delete") {
    if (!SOFT(table)) throw new ApiError(422, "validation", `${table} rows cannot be deleted`);
    const ex = db.query(`SELECT updated_at FROM ${table} WHERE ${key}=?`).get(row[key]) as any;
    if (!ex) return;
    if (ex.updated_at > ts) throw new ApiError(409, "stale", "server row is newer");
    db.run(`UPDATE ${table} SET deleted_at=?, updated_at=? WHERE ${key}=?`, [now(), now(), row[key]]); return;
  }
  delete row.created_by; delete row.created_at; delete row.updated_at;
  const res = upsertRow(table, row, { lww: ts, actor });
  if (res === "stale") throw new ApiError(409, "stale", "server row is newer");
}

export function syncRoutes() {
  const r = new Hono<Env>();

  r.get("/sync/pull", (c) => {
    const since = c.req.query("since");
    if (since && isNaN(Date.parse(since))) throw new ApiError(400, "validation", "since must be an ISO timestamp");
    const want = (c.req.query("tables")?.split(",").filter(Boolean)) ?? SNAPSHOT_TABLES;
    const bad = want.filter(t => !PULLABLE.includes(t));
    if (bad.length) throw new ApiError(400, "validation", `unknown tables: ${bad.join(",")}`);
    const server_time = now();
    const tables: Record<string, any[]> = {};
    for (const t of want) {
      const full = NO_UPDATED.includes(t) || !HAS_UPDATED_AT(t);
      const rows = !since || full ? db.query(`SELECT * FROM ${t}`).all() : db.query(`SELECT * FROM ${t} WHERE updated_at>?`).all(since);
      tables[t] = (rows as any[]).map(x => hydrate(t, x)!);
    }
    return c.json({ server_time, since: since ?? null, tables });
  });

  r.post("/sync/push", async (c) => {
    const body = await readJson(c);
    if (!Array.isArray(body?.ops)) throw new ApiError(422, "validation", "ops must be an array");
    if (body.ops.length > 1000) throw new ApiError(422, "validation", "max 1000 ops per push");
    const applied: string[] = [], rejected: { id: string; reason: string }[] = [];
    const actor = c.get("actor");
    for (const op of body.ops) {
      const id = String(op?.id ?? "");
      if (!id) { rejected.push({ id, reason: "op.id is required" }); continue; }
      const seen = db.query("SELECT ok, reason FROM sync_ops WHERE id=?").get(id) as any;
      if (seen) { if (seen.ok) applied.push(id); else rejected.push({ id, reason: seen.reason }); continue; }
      try {
        db.transaction(() => {
          applyOp(op, actor);
          const rawDate = op.table === 'jobs' ? op.data?.date_applied : op.table === 'checkins' ? op.data?.date :
            ['attempts', 'card_reviews'].includes(op.table) ? istDate(op.data?.at ?? op.client_ts ?? now()) : null;
          if (typeof rawDate === 'string' && /^\d{4}-\d\d-\d\d$/.test(rawDate)) sweepAutoTasks(rawDate);
          db.run("INSERT INTO sync_ops(id,at,ok,reason) VALUES (?,?,1,NULL)", [id, now()]);
        })();
        applied.push(id);
      } catch (e) {
        const reason = e instanceof ApiError ? `${e.code}: ${e.message}` : /constraint/i.test((e as Error).message) ? `constraint: ${(e as Error).message}` : `error: ${(e as Error).message}`;
        if (e instanceof ApiError && e.status < 500) db.run("INSERT INTO sync_ops(id,at,ok,reason) VALUES (?,?,0,?)", [id, now(), reason]);
        rejected.push({ id, reason });
      }
    }
    return c.json({ applied, rejected, server_time: now() });
  });
  return r;
}
