import { Hono } from "hono";
import { validator } from "hono/validator";
import { serveStatic } from "hono/bun";
import { compress } from "hono/compress";
import { db } from "./db";
import { config } from "./config";
import { ApiError } from "./errors";
import { authRoutes, requireAuth, type Env } from "./auth";
import { now } from "./util";
import { ensureMissedRun } from "./lib/services";
import { sweepAutoTasks } from './modules/planner/auto';
import { todayIST } from './util';
import { mediaRoutes, mediaUploadRoute } from "./modules/practice/questions";
import { syncRoutes } from "./routes/sync";
import { searchRoutes } from "./routes/search";
import { adminRoutes } from "./routes/admin";
import { configuredModules, enabledModules, moduleIds, moduleRoutes, type ModuleId } from "./modules";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

export function buildApp() {
  const app = new Hono<Env>();

  app.get("/healthz", (c) => {
    let ok = false;
    try { ok = (db.query("SELECT 1 AS x").get() as any).x === 1; } catch { /* db down */ }
    return c.json({ ok, db: ok, version: config.version }, ok ? 200 : 503);
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as any);
    }
    const msg = (err as Error).message ?? String(err);
    if (/UNIQUE constraint/i.test(msg)) return c.json({ error: { code: "conflict", message: msg, details: {} } }, 409);
    if (/constraint/i.test(msg)) return c.json({ error: { code: "constraint", message: msg, details: {} } }, 422);
    console.error(err);
    return c.json({ error: { code: "internal", message: "internal error", details: {} } }, 500);
  });

  app.use("/api/*", compress());
  // ---- /api
  const api = new Hono<Env>();
  api.route("/auth", authRoutes());
  api.use("*", requireAuth);
  api.use('*', async (c, next) => {
    await next();
    if (c.res.status >= 200 && c.res.status < 300 && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
        /^\/api\/(?:attempts|tests\/[^/]+\/submit|cards\/[^/]+\/review|concepts\/|checkins\/|jobs(?:\/|$)|plan\/tasks|settings$)/.test(c.req.path)) {
      try { sweepAutoTasks(todayIST()); } catch (e) { console.error('auto task check failed:', e); }
    }
  });
  api.use("*", async (c, next) => {
    ensureMissedRun();
    await next();
    if (c.req.path.endsWith("/healthz")) return;
    try {
      db.run("INSERT INTO api_log(at,actor,method,path,status) VALUES (?,?,?,?,?)", [now(), c.get("actor"), c.req.method, c.req.path, c.res.status]);
      if (Math.random() < 0.02) db.run("DELETE FROM api_log WHERE id <= (SELECT MAX(id) FROM api_log) - 5000");
    } catch { /* logging must never break a request */ }
  });
  // Idempotency-Key for writes
  api.use("*", async (c, next) => {
    const key = c.req.header("idempotency-key");
    if (!key || ["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
    const k = `${c.req.method} ${c.req.path} ${key}`.slice(0, 300);
    const hit = db.query("SELECT status, body FROM idempotency WHERE key=?").get(k) as any;
    if (hit) return new Response(hit.status === 204 ? null : hit.body, { status: hit.status, headers: { "Content-Type": "application/json", "Idempotent-Replay": "true" } });
    await next();
    if (c.res.status >= 200 && c.res.status < 300) {
      const body = c.res.status === 204 ? "" : await c.res.clone().text();
      db.run("INSERT OR IGNORE INTO idempotency(key,method,path,status,body,at) VALUES (?,?,?,?,?,?)", [k, c.req.method, c.req.path, c.res.status, body, now()]);
    }
  });
  api.get("/modules", c => c.json({ items: moduleIds.map(id => ({ id, available: configuredModules.includes(id), enabled: enabledModules().includes(id) })) }));
  api.patch("/modules/:id", validator("json", (body, c) => {
    if (!body || typeof body !== "object" || typeof (body as any).enabled !== "boolean") return c.json({ error: { code: "validation", message: "enabled must be boolean", details: {} } }, 422);
    return body as { enabled: boolean };
  }), c => {
    const id = c.req.param("id") as ModuleId;
    if (!moduleIds.includes(id) || !configuredModules.includes(id)) throw new ApiError(422, "validation", "Module is not available");
    const body = c.req.valid("json");
    db.query("INSERT INTO settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(`module.${id}`, body.enabled ? "1" : "0", now());
    return c.json({ id, enabled: body.enabled });
  });
  api.use("*", async (c, next) => {
    const path = c.req.path.replace(/^\/api/, "");
    const module: ModuleId | undefined = path.startsWith("/topics/") && path.endsWith("/explainer") ? "learn"
      : /^\/plan(?:\/|$)|^\/onboarding(?:\/|$)/.test(path) ? "planner"
      : /^\/videos(?:\/|$)/.test(path) ? "learn"
      : /^\/(subjects|topics|questions|attempts|mistakes|media)(?:\/|$)/.test(path) ? "practice"
      : /^\/(mastery|priority|drills)(?:\/|$)/.test(path) ? "practice"
      : /^\/(cards|games)(?:\/|$)/.test(path) ? "review"
      : /^\/(mocks|strategy)(?:\/|$)/.test(path) ? "mocks"
      : /^\/(checkins|streaks|stats|log|analytics|push)(?:\/|$)/.test(path) ? "habits"
      : /^\/jobs(?:\/|$)/.test(path) ? "jobs"
      : /^\/(doubts|reports|digest)(?:\/|$)/.test(path) ? "insights" : undefined;
    if (module && !enabledModules().includes(module)) return c.json({ error: { code: "not_found", message: "module disabled", details: {} } }, 404);
    await next();
  });
  for (const r of [adminRoutes(), mediaUploadRoute(), syncRoutes(), searchRoutes()]) api.route("/", r);
  for (const id of configuredModules) api.route("/", moduleRoutes(id));
  api.notFound((c) => c.json({ error: { code: "not_found", message: `no route ${c.req.method} ${c.req.path}`, details: {} } }, 404));
  app.route("/api", api);

  // ---- /media (authenticated)
  const media = new Hono<Env>();
  media.use("*", requireAuth);
  media.use("*", async (c, next) => { if (!enabledModules().includes("practice")) return c.json({ error: { code: "not_found", message: "module disabled", details: {} } }, 404); await next(); });
  media.route("/", mediaRoutes());
  app.route("/media", media);

  // ---- static PWA with SPA fallback
  const dist = config.webDist;
  if (existsSync(join(dist, "index.html"))) {
    const noCache = { "Cache-Control": "no-cache" };
    app.use("/assets/*", async (c, next) => { await next(); if (c.res.status === 200) c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable"); });
    app.use("*", serveStatic({ root: relative(process.cwd(), dist) || ".", onFound: (path, c) => { if (/\.(html|webmanifest)$|\/sw\.js$/.test(path)) c.header("Cache-Control", "no-cache"); } }));
    app.get("*", async (c) => {
      if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/media/")) return c.json({ error: { code: "not_found", message: "not found", details: {} } }, 404);
      return new Response(Bun.file(join(dist, "index.html")), { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache } });
    });
  } else {
    app.notFound((c) => c.json({ error: { code: "not_found", message: "not found (web/dist not built)", details: {} } }, 404));
  }
  return app;
}
