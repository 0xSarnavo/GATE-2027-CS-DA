import { Hono } from "hono";
import { db } from "../../db";
import type { Env } from "../../auth";
import { ApiError, notFound } from "../../errors";
import { parse, readJson, updateSql, insertSql, type Schema } from "../../validate";
import { addDays, dateParam, hydrate, isDate, now, todayIST, uuid } from "../../util";
import { capOf, STUDY_TYPES } from "../../lib/scheduler";
import { completeTask, computeStreaks, createdBy, dueCounts, ensurePlanDay, getSetting, getTask, logRevision, nextSort, recomputeTaskMinutes, runReschedule, settingsObj, undoRevision } from "../../lib/services";
import { effectiveMinutes, jobMinutes, refreshAutoMinutes, sweepAutoTasks, taskTopic } from "./auto";
import { parseTaskTitle } from "../../../shared/auto-task";

export const TASK_TYPES = ["study", "pyq", "revision", "mock", "GA", "job", "gym"] as const;
const TASK: Schema = {
  date: { t: "date", req: true }, title: { t: "str", req: true }, type: { t: "str", req: true, enum: TASK_TYPES },
  subject_id: { t: "str", nullable: true }, topic_id: { t: "str", nullable: true },
  est_minutes: { t: "int", min: 0, max: 1440 }, min_minutes: { t: "int", min: 0, nullable: true },
  priority: { t: "int", min: 1, max: 3 }, fixed: { t: "bool" }, sort: { t: "int" },
  status: { t: "str", enum: ["todo", "doing", "done", "skipped", "moved"] }, done_minutes: { t: "int", min: 0 },
  time_block: { t: "str", nullable: true, max: 40 },
};
const DAY: Schema = {
  available_minutes: { t: "int", min: 0, max: 1440, nullable: true },
  day_kind: { t: "str", enum: ["normal", "light", "off", "mock", "travel"] }, note: { t: "str", nullable: true },
};
const GOALS_ID = () => uuid().slice(-8);
function normGoals(g: any): string {
  if (!Array.isArray(g)) throw new ApiError(422, "validation", "macro_goals must be an array of {id?,text,done?}");
  return JSON.stringify(g.map((x: any) => ({ ...x, id: x.id ?? GOALS_ID(), text: String(x.text ?? ""), done: !!x.done })));
}
const weekOut = (w: any) => hydrate("weeks", w);
const STUDY = "('study','pyq','revision','mock','GA')";

function dayOut(d: any, s = settingsObj()) {
  const tasks = (db.query("SELECT * FROM plan_tasks WHERE date=? AND deleted_at IS NULL ORDER BY sort, id").all(d.date) as any[])
    .map(t => ({ ...t, target_topic_id: taskTopic(t), task_kind: parseTaskTitle(t.title, t.type).kind }));
  const cap = capOf({ date: d.date, week_id: d.week_id, available_minutes: d.available_minutes, day_kind: d.day_kind }, { weekdayMinutes: Number(s.weekday_study_minutes ?? 180), weekendMinutes: Number(s.weekend_study_minutes ?? 300) });
  let planned = 0;
  for (const t of tasks) if (!t.fixed && STUDY_TYPES.has(t.type)) {
    if (["todo", "doing", "done"].includes(t.status)) planned += t.est_minutes;
  }
  return { ...d, capacity_minutes: cap, planned_minutes: planned, done_minutes: effectiveMinutes(d.date), tasks };
}
const getDay = (date: string) => {
  const d = db.query("SELECT * FROM plan_days WHERE date=?").get(date) as any;
  return d ? dayOut(d) : null;
};
function taskPatch(id: string, patch: Record<string, any>) {
  const t = getTask(id);
  const p = { ...patch };
  if (p.date && p.date !== t.date) { ensurePlanDay(p.date); if (p.sort === undefined) p.sort = nextSort(p.date); }
  if (p.status === "done" && t.status !== "done") { p.completed_at = now(); if (p.done_minutes === undefined && !(t.done_minutes > 0)) p.done_minutes = t.est_minutes; }
  if (p.status && p.status !== "done" && t.status === "done") p.completed_at = null;
  if (p.status && p.status !== 'done' && t.status === 'done') { p.auto_done = 0; p.auto_reason = null; p.auto_undone_at = now(); }
  if (p.status === 'done') { p.auto_done = 0; p.auto_reason = null; p.auto_undone_at = null; }
  p.updated_at = now();
  const u = updateSql("plan_tasks", p, "id=?");
  db.run(u.sql, [...u.params, id]);
  recomputeTaskMinutes(t.date); if (p.date) recomputeTaskMinutes(p.date);
  return { before: t, after: getTask(id) };
}

export function planRoutes() {
  const r = new Hono<Env>();

  r.get("/plan", (c) => {
    const today = todayIST();
    const from = dateParam(c.req.query("from"), "from", today), to = dateParam(c.req.query("to"), "to", addDays(from, 14));
    const s = settingsObj();
    const days = (db.query("SELECT * FROM plan_days WHERE date BETWEEN ? AND ? ORDER BY date").all(from, to) as any[]).map(d => dayOut(d, s));
    const weeks = (db.query("SELECT * FROM weeks WHERE end_date>=? AND start_date<=? ORDER BY start_date").all(from, to) as any[]).map(weekOut);
    return c.json({ phases: db.query("SELECT * FROM phases ORDER BY start_date").all(), weeks, days });
  });

  r.get("/plan/today", (c) => {
    const today = c.req.query("date") ? dateParam(c.req.query("date"), "date") : todayIST();
    const s = settingsObj();
    const d = db.query("SELECT * FROM plan_days WHERE date=?").get(today) as any;
    const day = d ? dayOut(d, s) : null;
    const week = d ? weekOut(db.query("SELECT * FROM weeks WHERE id=?").get(d.week_id)) : weekOut(db.query("SELECT * FROM weeks WHERE start_date<=? AND end_date>=?").get(today, today));
    const phase = week ? db.query("SELECT * FROM phases WHERE id=?").get((week as any).phase_id) : null;
    const rev = db.query("SELECT * FROM plan_revisions WHERE actor='scheduler' AND reason LIKE 'missed%' AND date(at,'+330 minutes')=? ORDER BY at DESC LIMIT 1").get(today) as any;
    let banner = null as any;
    if (rev) {
      const diff = JSON.parse(rev.diff);
      const moved = (diff.changes ?? []).filter((x: any) => x.op === "carry").length;
      if (moved || (diff.changes ?? []).length) banner = { revision_id: rev.id, at: rev.at, moved, skipped: (diff.changes ?? []).filter((x: any) => x.op === "skip").length, undone: !!diff.undone_at };
    }
    return c.json({
      date: today, day, tasks: day?.tasks ?? [], available_minutes: day?.available_minutes ?? null, day_kind: day?.day_kind ?? null,
      capacity_minutes: day?.capacity_minutes ?? 0, planned_minutes: day?.planned_minutes ?? 0, done_minutes: day?.done_minutes ?? 0,
      questions_done: (db.query("SELECT COUNT(DISTINCT question_id) n FROM attempts WHERE date(at,'+330 minutes')=? AND given_answer IS NOT NULL AND trim(given_answer)<>''").get(today) as any).n,
      daily_question_goal: Number(s.daily_question_goal ?? 30),
      week, phase, due: dueCounts(today), streaks: computeStreaks(today),
      days_to_exam: Math.round((Date.parse((s.exam_date ?? today) + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000),
      missed_banner: banner,
    });
  });

  // ---- weeks
  r.get("/plan/weeks", (c) => {
    const rows = db.query(`SELECT w.*, (SELECT COALESCE(SUM(est_minutes),0) FROM plan_tasks t WHERE t.date BETWEEN w.start_date AND w.end_date AND t.deleted_at IS NULL AND t.fixed=0 AND t.type IN ${STUDY} AND t.status IN ('todo','doing','done')) planned_minutes,
      (SELECT COALESCE(SUM(minutes),0) FROM effective_study_minutes m WHERE m.date BETWEEN w.start_date AND w.end_date) done_minutes
      FROM weeks w ORDER BY start_date`).all() as any[];
    return c.json({ items: rows.map(weekOut), next: null });
  });
  r.put("/plan/weeks", async (c) => {
    const body = await readJson(c);
    if (!Array.isArray(body?.weeks)) throw new ApiError(422, "validation", "weeks must be an array");
    let updated = 0; const errors: any[] = [];
    db.transaction(() => {
      body.weeks.forEach((w: any, i: number) => {
        const row = db.query("SELECT id FROM weeks WHERE start_date=?").get(w.start_date) as any;
        if (!row) { errors.push({ index: i, message: `no week starts on ${w.start_date}` }); return; }
        patchWeek(row.id, w); updated++;
      });
      if (errors.length) throw new ApiError(422, "validation", "some weeks not found", { errors });
    })();
    return c.json({ updated });
  });
  function patchWeek(id: string, b: any) {
    const p: Record<string, any> = {};
    if (b.title !== undefined) p.title = b.title === null ? null : String(b.title);
    if (b.review_notes !== undefined) p.review_notes = b.review_notes === null ? null : String(b.review_notes);
    if (b.macro_goals !== undefined) p.macro_goals = normGoals(b.macro_goals);
    if (!Object.keys(p).length) return;
    p.updated_at = now();
    const u = updateSql("weeks", p, "id=?"); db.run(u.sql, [...u.params, id]);
  }
  const weekRow = (id: string) => {
    const w = db.query("SELECT * FROM weeks WHERE id=? OR start_date=?").get(id, id) as any;
    if (!w) throw notFound("week");
    return w;
  };
  r.get("/plan/weeks/:id", (c) => {
    const w = weekRow(c.req.param("id"));
    return c.json(weekOut(w));
  });
  r.patch("/plan/weeks/:id", async (c) => {
    const w = weekRow(c.req.param("id"));
    patchWeek(w.id, await readJson(c));
    return c.json(weekOut(db.query("SELECT * FROM weeks WHERE id=?").get(w.id)));
  });

  // ---- days
  r.get("/plan/days/:date", (c) => {
    const d = getDay(dateParam(c.req.param("date"), "date"));
    if (!d) throw notFound("plan day");
    return c.json(d);
  });
  r.patch("/plan/days/:date", async (c) => {
    const date = dateParam(c.req.param("date"), "date");
    const d = db.query("SELECT * FROM plan_days WHERE date=?").get(date) as any;
    if (!d) throw notFound("plan day");
    const p = parse(await readJson(c), DAY, true);
    let resched: any = null;
    if (Object.keys(p).length) {
      db.run(...(() => { const u = updateSql("plan_days", { ...p, updated_at: now() }, "date=?"); return [u.sql, [...u.params, date]] as [string, any[]]; })());
    }
    if (p.available_minutes != null && c.req.query("reschedule") !== "false" && date >= todayIST())
      resched = runReschedule({ kind: "capacity", date, minutes: p.available_minutes }, { actor: c.get("actor"), reason: `capacity ${date}=${p.available_minutes}` });
    return c.json({ ...getDay(date), reschedule: resched });
  });
  r.post("/plan/days/:date/capacity", async (c) => {
    const date = dateParam(c.req.param("date"), "date");
    if (!db.query("SELECT 1 FROM plan_days WHERE date=?").get(date)) throw notFound("plan day");
    const b = parse(await readJson(c), { minutes: { t: "int", req: true, min: 0, max: 1440 }, dry_run: { t: "bool" }, today: { t: "date" } });
    const dry = !!b.dry_run;
    const oldCapacity = (db.query("SELECT available_minutes FROM plan_days WHERE date=?").get(date) as any).available_minutes;
    // dry-run: simulate with the new capacity in a rolled-back transaction
    let out: any;
    const run = () => {
      db.run("UPDATE plan_days SET available_minutes=?, updated_at=? WHERE date=?", [b.minutes, now(), date]);
      const result = runReschedule({ kind: "capacity", date, minutes: b.minutes }, { today: b.today, dry, actor: c.get("actor"), reason: `capacity ${date}=${b.minutes}` });
      if (!dry && result.revision_id) {
        const row = db.query("SELECT diff FROM plan_revisions WHERE id=?").get(result.revision_id) as any;
        db.query("UPDATE plan_revisions SET diff=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(row.diff), capacity: { date, before: oldCapacity } }), result.revision_id);
      }
      return result;
    };
    if (dry) { try { db.transaction(() => { out = run(); throw new Error("__rollback__"); })(); } catch (e) { if ((e as Error).message !== "__rollback__") throw e; } }
    else out = db.transaction(run)();
    return c.json(out);
  });

  // ---- tasks
  r.post("/plan/tasks", async (c) => {
    const body = await readJson(c);
    const list: any[] = Array.isArray(body?.tasks) ? body.tasks : [body];
    if (!list.length || list.length > 500) throw new ApiError(422, "validation", "provide 1..500 tasks");
    const created: any[] = [];
    db.transaction(() => {
      for (const raw of list) {
        const t = parse(raw, TASK);
        ensurePlanDay(t.date);
        const row = {
          id: raw.id ?? uuid(), sort: nextSort(t.date), est_minutes: 30, priority: 2, fixed: t.type === "job" || t.type === "gym" ? 1 : 0,
          status: "todo", done_minutes: 0, ...t, origin_date: t.date, updated_at: now(), created_by: createdBy(c.get("actor")),
        };
        const i = insertSql("plan_tasks", row); db.run(i.sql, i.params);
        created.push(getTask(row.id));
      }
      logRevision(c.get("actor"), "tasks added", { added: created, changed: [], removed: [] });
    })();
    return c.json(Array.isArray(body?.tasks) ? { tasks: created } : created[0], 201);
  });
  r.get("/plan/tasks/:id", (c) => c.json(getTask(c.req.param("id"))));
  r.patch("/plan/tasks/:id", async (c) => {
    const p = parse(await readJson(c), { ...TASK, carry_count: { t: "int", min: 0 }, origin_date: { t: "date", nullable: true } }, true);
    const { before, after } = db.transaction(() => taskPatch(c.req.param("id"), p))();
    const structural = Object.keys(p).some(k => !["status", "done_minutes", "completed_at"].includes(k));
    if (structural) logRevision(c.get("actor"), "task edited", { added: [], changed: [{ id: before.id, before, after }], removed: [] });
    return c.json(after);
  });
  r.delete("/plan/tasks/:id", (c) => {
    const t = getTask(c.req.param("id"));
    db.run("UPDATE plan_tasks SET deleted_at=?, updated_at=? WHERE id=?", [now(), now(), t.id]);
    recomputeTaskMinutes(t.date);
    logRevision(c.get("actor"), "task deleted", { added: [], changed: [], removed: [t.id] });
    return c.body(null, 204);
  });
  r.post("/plan/tasks/:id/complete", async (c) => {
    let b: any = {};
    try { b = await c.req.json(); } catch { /* empty body ok */ }
    const dm = b?.done_minutes == null ? undefined : Number(b.done_minutes);
    if (dm !== undefined && (!Number.isInteger(dm) || dm < 0)) throw new ApiError(422, "validation", "done_minutes must be a non-negative integer");
    return c.json(completeTask(c.req.param("id"), dm));
  });

  r.post('/plan/active-time', async c => {
    const b = parse(await readJson(c), { id: { t: 'str', req: true }, date: { t: 'date', req: true },
      kind: { t: 'str', req: true, enum: ['study', 'job'] }, topic_id: { t: 'str', nullable: true }, seconds: { t: 'int', req: true, min: 1, max: 120 } });
    let subject: string | null = null;
    if (b.kind === 'study') {
      if (!b.topic_id) throw new ApiError(422, 'validation', 'topic_id required for study time');
      const topic = db.query('SELECT subject_id FROM topics WHERE id=? AND deleted_at IS NULL').get(b.topic_id) as any;
      if (!topic) throw new ApiError(422, 'validation', 'unknown topic_id');
      subject = topic.subject_id;
    }
    const inserted = db.run('INSERT OR IGNORE INTO active_time_batches(id,date,kind,topic_id,subject_id,seconds,created_at) VALUES (?,?,?,?,?,?,?)',
      [b.id, b.date, b.kind, b.kind === 'study' ? b.topic_id : null, subject, b.seconds, now()]).changes > 0;
    if (inserted && b.kind === 'study') refreshAutoMinutes(b.date);
    if (inserted) sweepAutoTasks(b.date);
    return c.json({ id: b.id, duplicate: !inserted, study_minutes_total: effectiveMinutes(b.date), job_minutes: jobMinutes(b.date) });
  });

  // ---- scheduler
  r.post("/plan/reschedule", async (c) => {
    const b = parse(await readJson(c), {
      trigger: { t: "str", req: true, enum: ["missed", "rebalance"] }, week_start: { t: "date" }, dry_run: { t: "bool" }, today: { t: "date" },
    });
    return c.json(runReschedule({ kind: b.trigger }, { today: b.today, weekDate: b.week_start, dry: !!b.dry_run, actor: c.get("actor"), reason: `${b.trigger} (manual)` }));
  });

  r.post("/plan/replace", async (c) => {
    const body = await readJson(c);
    const from = dateParam(body?.from, "from"), to = dateParam(body?.to, "to");
    if (from > to) throw new ApiError(422, "validation", "from must be <= to");
    if (!Array.isArray(body.tasks)) throw new ApiError(422, "validation", "tasks must be an array");
    let out: any;
    db.transaction(() => {
      const old = db.query("SELECT id FROM plan_tasks WHERE date BETWEEN ? AND ? AND deleted_at IS NULL AND status IN ('todo','doing')").all(from, to) as any[];
      for (const o of old) db.run("UPDATE plan_tasks SET deleted_at=?, updated_at=? WHERE id=?", [now(), now(), o.id]);
      const added: any[] = [];
      for (const raw of body.tasks) {
        const t = parse(raw, TASK);
        if (t.date < from || t.date > to) throw new ApiError(422, "validation", `task date ${t.date} outside ${from}..${to}`);
        ensurePlanDay(t.date);
        const row = { id: raw.id ?? uuid(), sort: nextSort(t.date), est_minutes: 30, priority: 2, fixed: t.type === "job" || t.type === "gym" ? 1 : 0, status: "todo", done_minutes: 0, ...t, origin_date: t.date, updated_at: now(), created_by: createdBy(c.get("actor")) };
        if (db.query("SELECT 1 FROM plan_tasks WHERE id=?").get(row.id)) throw new ApiError(422, "validation", `task id ${row.id} already exists`);
        const i = insertSql("plan_tasks", row); db.run(i.sql, i.params);
        added.push(row);
      }
      let weeks = 0;
      if (Array.isArray(body.weeks)) for (const w of body.weeks) {
        const row = db.query("SELECT id FROM weeks WHERE start_date=?").get(w.start_date) as any;
        if (!row) throw new ApiError(422, "validation", `no week starts on ${w.start_date}`);
        patchWeek(row.id, w); weeks++;
      }
      for (let d = from; d <= to; d = addDays(d, 1)) recomputeTaskMinutes(d);
      const revision_id = logRevision(c.get("actor"), body.reason ?? "plan replace", { added, changed: [], removed: old.map(o => o.id), range: { from, to } });
      out = { revision_id, counts: { removed: old.length, added: added.length, weeks } };
    })();
    return c.json(out);
  });

  r.get("/plan/revisions", (c) => {
    const limit = Math.min(500, Number(c.req.query("limit")) || 50);
    const rows = db.query("SELECT * FROM plan_revisions ORDER BY at DESC LIMIT ?").all(limit) as any[];
    return c.json({ items: rows.map(x => hydrate("plan_revisions", x)), next: null });
  });
  r.post("/plan/revisions/:id/undo", (c) => c.json(undoRevision(c.req.param("id"), c.get("actor"))));

  return r;
}
