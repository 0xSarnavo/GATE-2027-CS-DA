import { Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { getConnInfo } from "hono/bun";
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { db } from "./db";
import { config } from "./config";
import { ApiError } from "./errors";
import { now } from "./util";

export type Actor = "user" | "claude";
export type Env = { Variables: { actor: Actor } };

const sha = (s: string) => createHash("sha256").update(s).digest();
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha(a), sha(b)) && a.length > 0 && b.length > 0;
}
const hashSid = (sid: string) => createHash("sha256").update(config.sessionSecret + ":" + sid).digest("hex");

// ---- login rate limit: 5 attempts / 15 min / IP, in memory
const attempts = new Map<string, number[]>();
const WINDOW = 15 * 60_000, MAX_ATTEMPTS = 5;
export function rateLimited(ip: string, t = Date.now()): boolean {
  const arr = (attempts.get(ip) ?? []).filter(x => t - x < WINDOW);
  if (arr.length >= MAX_ATTEMPTS) { attempts.set(ip, arr); return true; }
  arr.push(t); attempts.set(ip, arr);
  return false;
}
export const resetRateLimit = () => attempts.clear();

// Railway's edge proxy appends the real client address as the last X-Forwarded-For entry; earlier entries are client-supplied.
// The socket address alone is the proxy, which would put every visitor (and the owner) in one bucket.
function clientIp(c: any): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",").pop()!.trim();
  try { return getConnInfo(c).remote.address ?? "unknown"; } catch { return "unknown"; }
}

/** Resolve credential -> actor, or null. */
export function authenticate(c: any): Actor | null {
  const h = c.req.header("authorization");
  if (h && /^bearer /i.test(h)) {
    const tok = h.slice(7).trim();
    return config.apiToken && safeEqual(tok, config.apiToken) ? "claude" : null;
  }
  const sid = getCookie(c, "sid");
  if (sid) {
    const row = db.query("SELECT expires_at FROM sessions WHERE token_hash=?").get(hashSid(sid)) as any;
    if (row && row.expires_at > now()) return "user";
  }
  return null;
}

export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const actor = authenticate(c);
  if (!actor) throw new ApiError(401, "unauthorized", "authentication required");
  // CSRF defence for cookie-authenticated writes
  const bearer = /^bearer /i.test(c.req.header("authorization") ?? "");
  if (!bearer && !["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("x-requested-with") !== "app")
    throw new ApiError(403, "csrf", "missing X-Requested-With: app header");
  c.set("actor", actor);
  await next();
};

export function authRoutes() {
  const r = new Hono<Env>();
  r.post("/login", async (c) => {
    if (!config.passwordHash) throw new ApiError(503, "not_configured", "APP_PASSWORD_HASH is not set");
    if (rateLimited(clientIp(c))) {
      c.header("Retry-After", String(WINDOW / 1000));
      throw new ApiError(429, "rate_limited", "too many login attempts, try again later");
    }
    let body: any = {};
    try { body = await c.req.json(); } catch { /* fallthrough */ }
    const pw = typeof body?.password === "string" ? body.password : "";
    let ok = false;
    try { ok = pw !== "" && await Bun.password.verify(pw, config.passwordHash); } catch { ok = false; }
    if (!ok) throw new ApiError(401, "unauthorized", "invalid password");
    const sid = randomBytes(32).toString("hex");
    const exp = new Date(Date.now() + 30 * 86400_000);
    db.run("INSERT INTO sessions(token_hash,created_at,expires_at) VALUES (?,?,?)", [hashSid(sid), now(), exp.toISOString()]);
    const secure = config.prod || c.req.header("x-forwarded-proto") === "https";
    setCookie(c, "sid", sid, { httpOnly: true, secure, sameSite: "Lax", path: "/", expires: exp });
    return c.body(null, 204);
  });
  r.post("/logout", requireAuth, (c) => {
    const sid = getCookie(c, "sid");
    if (sid) db.run("DELETE FROM sessions WHERE token_hash=?", [hashSid(sid)]);
    deleteCookie(c, "sid", { path: "/" });
    return c.body(null, 204);
  });
  return r;
}
