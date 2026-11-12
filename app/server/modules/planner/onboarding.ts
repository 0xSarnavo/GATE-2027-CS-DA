import { Hono } from "hono";
import { validator } from "hono/validator";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../../auth";
import { config } from "../../config";
import { db } from "../../db";
import { ApiError } from "../../errors";
import { now } from "../../util";
import { runSeed } from "../../../seed/load";
import { generatePlan, type PlanInput, type Topic } from "./generate";
import type { ModuleId } from "../config";

const hasPlan = db.query("SELECT 1 FROM weeks LIMIT 1");
const addPhase = db.query("INSERT INTO phases(id,name,start_date,end_date,description,updated_at) VALUES (?,?,?,?,?,?)");
const addWeek = db.query("INSERT INTO weeks(id,phase_id,week_no,start_date,end_date,title,macro_goals,updated_at) VALUES (?,?,?,?,?,?,?,?)");
const addDay = db.query("INSERT INTO plan_days(date,week_id,available_minutes,day_kind,updated_at) VALUES (?,?,?,?,?)");
const addTask = db.query("INSERT INTO plan_tasks(id,date,sort,title,subject_id,topic_id,type,est_minutes,min_minutes,priority,fixed,status,done_minutes,origin_date,updated_at,time_block,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
const setSetting = db.query("INSERT INTO settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");

export function onboardingRoutes(configuredModules: readonly ModuleId[]) {
  const r = new Hono<Env>();
  r.get("/onboarding/status", c => c.json({ needs_setup: !hasPlan.get() }));
  r.post("/onboarding", validator("json", (body, c) => {
    if (!body || typeof body !== "object" || !["CS", "DA", "both"].includes((body as any).papers)) return c.json({ error: { code: "validation", message: "Choose CS, DA or both", details: {} } }, 422);
    return body as PlanInput & { modules?: string[] };
  }), c => {
    if (hasPlan.get()) throw new ApiError(409, "conflict", "A plan already exists");
    const input = c.req.valid("json");
    const topicPath = join(config.contentDir, "topics.json");
    const topics = JSON.parse(readFileSync(existsSync(topicPath) ? topicPath : join(config.appRoot, "seed", "topics.json"), "utf8")) as Topic[];
    let plan;
    try { plan = generatePlan(input, topics); }
    catch (e) { throw new ApiError(422, "validation", (e as Error).message); }
    if (input.modules && (!Array.isArray(input.modules) || input.modules.some(id => !configuredModules.includes(id as any)))) throw new ApiError(422, "validation", "Invalid module selection");
    runSeed({ includeOwnerPlan: false });
    db.transaction(() => {
      if (hasPlan.get()) throw new ApiError(409, "conflict", "A plan already exists");
      const t = now();
      for (const p of plan.phases) addPhase.run(p.id, p.name, p.start, p.end, p.description, t);
      for (const w of plan.weeks) addWeek.run(`onboard-w${w.week_no}`, w.phase_id, w.week_no, w.start, w.end, w.label, JSON.stringify(w.macro_goals.map((g, i) => ({ ...g, id: `onboard-w${w.week_no}-g${i + 1}` }))), t);
      for (const d of plan.days) {
        const week = plan.weeks.find(w => w.start <= d.date && d.date <= w.end)!;
        addDay.run(d.date, `onboard-w${week.week_no}`, null, d.kind, t);
        for (const [i, task] of d.tasks.entries()) addTask.run(`onboard-${d.date}-${i}`, d.date, i + 1, task.title,
          task.topic_id?.split(".")[0] ?? null, task.topic_id, task.type, task.minutes, task.fixed ? null : Math.max(15, Math.round(task.minutes * .5)), task.priority, task.fixed, "todo", 0, d.date, t, task.time_block ?? null, "user");
      }
      setSetting.run("exam_date", input.examDate, t);
      setSetting.run("weekday_study_minutes", String(Math.round(input.weekdayHours * 60)), t);
      setSetting.run("weekend_study_minutes", String(Math.round(input.weekendHours * 60)), t);
      setSetting.run("papers", input.papers, t);
      setSetting.run("routine_blocks", JSON.stringify(input.routineBlocks ?? []), t);
      setSetting.run("break_periods", JSON.stringify(input.breaks ?? []), t);
      if (input.modules) for (const id of configuredModules) setSetting.run(`module.${id}`, input.modules.includes(id) ? "1" : "0", t);
    })();
    return c.json({ created: true, weeks: plan.weeks.length, days: plan.days.length }, 201);
  });
  return r;
}
