import { Hono } from "hono";
import { db } from "../db";
import type { Env } from "../auth";
import { config } from "../config";
import { ApiError } from "../errors";
import { readJson } from "../validate";
import { now, todayIST, uuid } from "../util";
import { TABLES, TABLE_BY, columns, csvToRows, upsertRow } from "../lib/importer";
import { latestBackup, manualBackup, preImportBackup, backupDir } from "../lib/backup";
import { getSetting, setSetting, settingsObj } from "../lib/services";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROLLBACK = Symbol("rollback");
const EXPORT_TABLES = TABLES.map(t => t.name);

function normalizeData(data: any): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  if (!data || typeof data !== "object") throw new ApiError(422, "validation", "data must be an object");
  for (const [k, v] of Object.entries(data)) {
    if (k === "plan" && v && typeof v === "object") {
      const p = v as any;
      for (const [src, dst] of [["phases", "phases"], ["weeks", "weeks"], ["days", "plan_days"], ["tasks", "plan_tasks"], ["plan_days", "plan_days"], ["plan_tasks", "plan_tasks"]] as const)
        if (Array.isArray(p[src])) out[dst] = [...(out[dst] ?? []), ...p[src]];
      continue;
    }
    if (k === "settings" && v && !Array.isArray(v) && typeof v === "object") { out.settings = Object.entries(v as any).map(([key, value]) => ({ key, value: String(value), updated_at: now() })); continue; }
    if (["exported_at", "schema_version", "media"].includes(k)) continue;
    if (!TABLE_BY.has(k)) throw new ApiError(422, "validation", `unknown import key '${k}'`);
    if (!Array.isArray(v)) throw new ApiError(422, "validation", `data.${k} must be an array`);
    out[k] = [...(out[k] ?? []), ...v];
  }
  return out;
}

export function doImport(opts: { mode: "merge" | "replace_tables"; dry: boolean; data: any; actor: string }) {
  const tables = normalizeData(opts.data);
  const counts = { created: 0, updated: 0, skipped: 0 };
  const per_table: Record<string, { created: number; updated: number; skipped: number }> = {};
  const errors: { table: string; index: number; message: string }[] = [];
  let backup: string | null = null;
  if (!opts.dry) backup = preImportBackup(db).path;
  try {
    db.transaction(() => {
      db.run("PRAGMA defer_foreign_keys=ON");
      if (opts.mode === "replace_tables")
        for (const t of [...TABLES].reverse()) if (tables[t.name]) db.run(`DELETE FROM ${t.name}`);
      for (const t of TABLES) {
        const rows = tables[t.name]; if (!rows) continue;
        const pt = (per_table[t.name] = { created: 0, updated: 0, skipped: 0 });
        rows.forEach((raw, i) => {
          try {
            if (raw === null || typeof raw !== "object") throw new Error("row must be an object");
            const res = upsertRow(t.name, raw, { actor: "import" });
            const k = res === "stale" ? "skipped" : res;
            counts[k]++; pt[k]++;
          } catch (e) { errors.push({ table: t.name, index: i, message: (e as Error).message }); }
        });
      }
      if (opts.mode === "replace_tables" || true) {
        const bad = db.query("PRAGMA foreign_key_check").all() as any[];
        for (const b of bad.slice(0, 20)) errors.push({ table: b.table, index: -1, message: `foreign key violation (rowid ${b.rowid}) -> ${b.parent}` });
      }
      if (errors.length || opts.dry) throw ROLLBACK;
    })();
  } catch (e) { if (e !== ROLLBACK) throw e; }
  const applied = !opts.dry && !errors.length;
  if (!opts.dry) db.run("INSERT INTO import_runs(id,at,actor,counts,errors) VALUES (?,?,?,?,?)", [uuid(), now(), opts.actor, JSON.stringify({ ...counts, applied, mode: opts.mode, per_table }), JSON.stringify(errors.slice(0, 100))]);
  return { dry_run: opts.dry, applied, mode: opts.mode, counts, per_table, errors, backup };
}

export function adminRoutes() {
  const r = new Hono<Env>();

  r.get("/me", (c) => c.json({ actor: c.get("actor"), server_time: now(), today: todayIST() }));

  r.get("/settings", (c) => c.json(settingsObj()));
  r.patch("/settings", async (c) => {
    const b = await readJson(c);
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new ApiError(422, "validation", "body must be {key: value}");
    db.transaction(() => { for (const [k, v] of Object.entries(b)) {
      if (!/^[a-z0-9_]{1,64}$/.test(k)) throw new ApiError(422, "validation", `bad key ${k}`);
      if (v === null || typeof v === "object") throw new ApiError(422, "validation", `value for ${k} must be a string or number`);
      if (k === "daily_question_goal" && (!/^(?:0|[1-9]\d*)$/.test(String(v)) || Number(v) > 200)) throw new ApiError(422, "validation", "daily_question_goal must be 0–200");
      setSetting(k, String(v));
    } })();
    return c.json(settingsObj());
  });

  r.post("/import/content", async (c) => {
    const { runImportContent } = await import("../../seed/import_content");
    return c.json(runImportContent());
  });

  r.post("/import", async (c) => {
    const ct = c.req.header("content-type") ?? "";
    const dry = c.req.query("dry_run") === "1" || c.req.query("dry_run") === "true";
    let mode = (c.req.query("mode") as any) ?? "merge", data: any, dryBody = dry;
    if (ct.includes("text/csv")) {
      const table = c.req.query("table");
      if (table !== "jobs" && table !== "mocks") throw new ApiError(400, "validation", "?table=jobs|mocks is required for CSV");
      data = { [table]: csvToRows(table, await c.req.text()) };
    } else {
      const b = await readJson(c);
      mode = b.mode ?? mode; dryBody = dry || b.dry_run === true || b.dry_run === 1; data = b.data ?? (b.mode === undefined && !b.data ? undefined : b.data);
      if (!data) throw new ApiError(422, "validation", "data is required");
    }
    if (mode !== "merge" && mode !== "replace_tables") throw new ApiError(422, "validation", "mode must be merge|replace_tables");
    const out = doImport({ mode, dry: dryBody, data, actor: c.get("actor") });
    return c.json(out, out.errors.length && !out.dry_run ? 422 : 200);
  });

  r.get("/export", (c) => {
    const out: any = { exported_at: now(), schema_version: (db.query("PRAGMA user_version").get() as any).user_version };
    for (const t of EXPORT_TABLES) out[t] = db.query(`SELECT * FROM ${t}`).all();
    const dir = join(config.dataDir, "media");
    out.media = existsSync(dir) ? readdirSync(dir).map(f => ({ path: `media/${f}`, sha: createHash("sha256").update(readFileSync(join(dir, f))).digest("hex").slice(0, 16), bytes: statSync(join(dir, f)).size })) : [];
    c.header("Content-Disposition", `attachment; filename="gate-export-${todayIST()}.json"`);
    return c.json(out);
  });

  r.post("/admin/backup", (c) => {
    const b = manualBackup(db);
    return c.json({ path: b.path, bytes: b.bytes }, 201);
  });
  r.get("/admin/backups", (c) => {
    const dir = backupDir();
    const items = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".db")).sort().reverse().map(f => ({ name: f, bytes: statSync(join(dir, f)).size, modified: statSync(join(dir, f)).mtime.toISOString() })) : [];
    return c.json({ items, next: null });
  });
  r.get("/admin/backup/latest", (c) => {
    const p = latestBackup();
    if (!p) throw new ApiError(404, "not_found", "no backups yet");
    return new Response(Bun.file(p), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${p.split("/").pop()}"` } });
  });

  r.get("/README.md", async (c) => {
    const p = join(import.meta.dir, "..", "API.md");
    if (!existsSync(p)) throw new ApiError(404, "not_found", "API.md missing");
    return new Response(await Bun.file(p).text(), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  });
  void getSetting; void columns;
  return r;
}
