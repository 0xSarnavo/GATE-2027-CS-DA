import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import type { Env } from "../auth";
import { config } from "../config";
import { db } from "../db";
import { planRoutes } from "./planner/routes";
import { checkinRoutes } from "./habits/routes";
import { topicRoutes } from "./practice/topics";
import { questionRoutes } from "./practice/questions";
import { learnRoutes } from "./learn/routes";
import { progressRoutes } from "./learn/progress";
import { readinessRoutes } from "./learn/readiness";
import { bookmarkRoutes } from "./practice/bookmarks";
import { testRoutes } from "./practice/tests";
import { weightageRoutes } from "./practice/weightage";
import { cardRoutes } from "./review/routes";
import { mockRoutes } from "./mocks/routes";
import { statsRoutes } from "./habits/stats";
import { onboardingRoutes } from "./planner/onboarding";
import { practiceAnalyticsRoutes } from "./practice/analytics";
import { strategyRoutes } from "./mocks/strategy";
import { pushRoutes } from "./habits/push";
import { habitsAnalyticsRoutes } from "./habits/analytics";
import { insightsRoutes } from "./insights/routes";
import { jobRoutes } from "./jobs/routes";

import { moduleIds, resolveModules, type ModuleId } from "./config";
export { moduleIds, resolveModules, type ModuleId } from "./config";
const routes: Record<ModuleId, () => Hono<Env>> = {
  planner: () => { const r = new Hono<Env>(); r.route("/", planRoutes()); r.route("/", onboardingRoutes(configuredModules)); return r; }, practice: () => { const r = new Hono<Env>(); r.route("/", topicRoutes()); r.route("/", questionRoutes()); r.route("/", bookmarkRoutes()); r.route("/", testRoutes()); r.route("/", weightageRoutes()); r.route("/", practiceAnalyticsRoutes()); return r; },
  learn: () => { const r = new Hono<Env>(); r.route("/", learnRoutes()); r.route("/", progressRoutes()); r.route("/", readinessRoutes()); return r; }, review: cardRoutes, mocks: () => { const r = new Hono<Env>(); r.route("/", mockRoutes()); r.route("/", strategyRoutes()); return r; },
  habits: () => { const r = new Hono<Env>(); r.route("/", checkinRoutes()); r.route("/", statsRoutes()); r.route("/", habitsAnalyticsRoutes()); r.route("/", pushRoutes()); return r; }, jobs: jobRoutes, insights: insightsRoutes,
};
const file = JSON.parse(readFileSync(join(config.appRoot, "app.config.json"), "utf8")) as { modules: string[] };
export const configuredModules = resolveModules(file.modules, config.moduleEnv);
const findEnabled = db.query("SELECT key, value FROM settings WHERE key LIKE 'module.%'");
const hasPlan = db.query("SELECT 1 FROM weeks LIMIT 1");
export function enabledModules(): ModuleId[] {
  const overrides = new Map((findEnabled.all() as { key: string; value: string }[]).map(x => [x.key.slice(7) as ModuleId, x.value === "1"]));
  return configuredModules.filter(id => overrides.has(id) ? overrides.get(id) === true : id !== "jobs" || !!hasPlan.get());
}
export function moduleRoutes(id: ModuleId) { return routes[id](); }
