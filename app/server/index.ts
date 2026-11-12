import { config } from "./config";
import { db } from "./db";
import { buildApp } from "./app";
import { startBackupTimer } from "./lib/backup";
import { existsSync } from "node:fs";

if (config.prod) {
  const missing = ["APP_PASSWORD_HASH", "API_TOKEN", "SESSION_SECRET"].filter(k => !process.env[k]);
  if (missing.length) { console.error(`refusing to start: missing env ${missing.join(", ")}`); process.exit(1); }
  if (process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_DIR && !process.env.ALLOW_EPHEMERAL_DATA) {
    console.error("refusing to start: no Railway volume mounted (set ALLOW_EPHEMERAL_DATA=1 to override)"); process.exit(1);
  }
} else {
  if (!config.passwordHash) console.warn("[dev] APP_PASSWORD_HASH not set: password login disabled (bearer API_TOKEN still works)");
  if (!config.apiToken) console.warn("[dev] API_TOKEN not set: bearer auth disabled");
}
db.run("DELETE FROM sessions WHERE expires_at < ?", [new Date().toISOString()]);

if ((db.query("SELECT COUNT(*) n FROM topics").get() as any).n === 0) {
  const { runSeed } = await import("../seed/load");
  console.log("Seeding content for empty database", await runSeed({ includeOwnerPlan: process.env.SEED_ON_BOOT === "1" && (process.env.PROFILE || "owner") === "owner" }));
}
const { seedMissingTopics, seedFoundationPlan } = await import("../seed/load");
console.log("New seed topics:", seedMissingTopics());
console.log("New foundation plan tasks:", seedFoundationPlan());

if (process.env.IMPORT_ON_BOOT !== "0") {
  try {
    const { runImportContent } = await import("../seed/import_content");
    const r = runImportContent();
    console.log("import-content:", JSON.stringify(r.counts), `(${r.warnings.length} warnings)`);
    for (const w of r.warnings.slice(0, 20)) console.warn("  warn:", w);
  } catch (e) { console.error("import-content failed (continuing):", e); }
}

const { snapshotMastery } = await import("./modules/practice/analytics");
const { enabledModules } = await import("./modules");
const { todayIST, addDays } = await import("./util");
let lastSnapshotDay = "";
const dailySnapshot = () => { const day = todayIST(); if (day === lastSnapshotDay || !enabledModules().includes('practice')) return; try { snapshotMastery(addDays(day, -1)); snapshotMastery(day); lastSnapshotDay = day; } catch (e) { console.error("mastery snapshot failed", e); } };
dailySnapshot();
const snapshotTimer = setInterval(dailySnapshot, 60_000);
const { sweepAutoTasks } = await import('./modules/planner/auto');
const autoTaskTimer = setInterval(() => { try { sweepAutoTasks(); } catch (e) { console.error('auto task sweep failed', e); } }, 3_600_000);
sweepAutoTasks();
const app = buildApp();
startBackupTimer(db);
const { runReminderScheduler } = await import("./modules/habits/push");
if (enabledModules().includes('habits')) runReminderScheduler().catch(console.error);
const reminderTimer = setInterval(() => { if (enabledModules().includes('habits')) runReminderScheduler().catch(console.error); }, 60_000);
const server = Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 30 });
console.log(`gate27 server on :${server.port} data=${config.dataDir} web=${existsSync(config.webDist) ? "yes" : "no"}`);
process.on("SIGTERM", () => { clearInterval(reminderTimer); clearInterval(snapshotTimer); clearInterval(autoTaskTimer); server.stop(); db.close(); process.exit(0); });
