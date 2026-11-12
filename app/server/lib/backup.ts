import type { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import { istDate } from "../util";

export const backupDir = () => join(config.dataDir, "backups");

/** Consistent copy via VACUUM INTO (safe under WAL). Returns path + size. */
export function backupTo(db: Database, name: string): { path: string; bytes: number } {
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  let path = join(dir, `${name}.db`);
  for (let i = 2; existsSync(path); i++) path = join(dir, `${name}-${i}.db`);
  db.run("VACUUM INTO ?", [path]);
  return { path, bytes: statSync(path).size };
}

function stamp(d = new Date()) {
  const ist = new Date(d.getTime() + 330 * 60_000).toISOString();
  return { day: ist.slice(0, 10).replaceAll("-", ""), hm: ist.slice(11, 16).replace(":", "") };
}
export function manualBackup(db: Database) { const s = stamp(); return backupTo(db, `gate-${s.day}-${s.hm}`); }
export function preImportBackup(db: Database) { const s = stamp(); const r = backupTo(db, `pre-import-${s.day}-${s.hm}`); prune(/^pre-import-.*\.db$/, 10); return r; }
const pushed = new Set<string>();

/** Delete all but the newest `keep` files matching pattern (names sort chronologically). */
export function prune(pattern: RegExp, keep: number) {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => pattern.test(f)).sort();
  const drop = files.slice(0, Math.max(0, files.length - keep));
  for (const f of drop) unlinkSync(join(dir, f));
  return drop;
}

export function latestBackup(): string | null {
  const dir = backupDir();
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => /^gate-.*\.db$/.test(f)).sort();
  return files.length ? join(dir, files[files.length - 1]!) : null;
}

/** Nightly job: VACUUM INTO gate-YYYYMMDD.db after 02:30 IST if today's is missing (catches up on startup). */
export async function nightlyBackupIfDue(db: Database, nowDate = new Date()): Promise<string | null> {
  const s = stamp(nowDate);
  if (Number(s.hm) < 230) return null;
  const dir = backupDir();
  const target = join(dir, `gate-${s.day}.db`);
  const existing = existsSync(target);
  if (existing && (!config.backupPushUrl || pushed.has(target))) return null;
  const r = existing ? { path: target } : backupTo(db, `gate-${s.day}`);
  if (!existing) prune(/^gate-\d{8}(-\d{4})?(-\d+)?\.db$/, config.backupKeep);
  if (config.backupPushUrl) {
    try { const response = await fetch(config.backupPushUrl, { method: "PUT", body: readFileSync(r.path) }); if (response.ok) pushed.add(target); else console.error("backup push failed: HTTP", response.status); }
    catch { console.error("backup push failed: network error"); }
  }
  return existing ? null : r.path;
}

export function startBackupTimer(db: Database) {
  const tick = () => nightlyBackupIfDue(db).catch(e => console.error("nightly backup failed:", e));
  tick();
  return setInterval(tick, 5 * 60_000);
}
export { istDate };
