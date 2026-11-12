import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync, existsSync, accessSync, constants, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

export function assertDataDirWritable(dir = config.dataDir) {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    const probe = join(dir, ".write-test");
    writeFileSync(probe, "ok"); unlinkSync(probe);
  } catch (e) {
    throw new Error(`DATA_DIR ${dir} is not writable: ${(e as Error).message}`);
  }
}

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");
  db.run("PRAGMA synchronous=NORMAL");
  db.run("PRAGMA busy_timeout=5000");
  return db;
}

export const migrationsDir = join(import.meta.dir, "migrations");
export function listMigrations() {
  return readdirSync(migrationsDir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
    .map(f => ({ n: Number(f.slice(0, 4)), file: f }));
}
export function pendingMigrations(db: Database) {
  const cur = (db.query("PRAGMA user_version").get() as any).user_version as number;
  return { cur, pending: listMigrations().filter(m => m.n > cur) };
}
/** Apply pending migrations in order, each in a transaction. Returns count applied. */
export function migrate(db: Database): number {
  const { pending } = pendingMigrations(db);
  for (const m of pending) {
    const sql = readFileSync(join(migrationsDir, m.file), "utf8");
    db.transaction(() => { db.exec(sql); db.run(`PRAGMA user_version=${m.n}`); })();
  }
  return pending.length;
}

assertDataDirWritable();
export const dbPath = join(config.dataDir, "gate.db");
export const db = openDb(dbPath);
// pre-migration safety copy (file copy is safe here: no other writers yet)
{
  const { cur, pending } = pendingMigrations(db);
  if (pending.length && cur > 0 && existsSync(dbPath)) {
    const { backupTo } = await import("./lib/backup");
    backupTo(db, `pre-migrate-v${cur}`);
  }
}
migrate(db);
