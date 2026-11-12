import { Hono } from "hono";
import { db } from "../../db";
import type { Env } from "../../auth";
import { ApiError } from "../../errors";
import { parse, readJson, bind, type Schema } from "../../validate";
import { addDays, dateParam, diffDays, now, todayIST, page, paging, hydrate } from "../../util";
import { computeStreaks } from "../../lib/services";
import { jobCounts, jobMinutes, sweepAutoTasks } from '../planner/auto';

const CHECKIN: Schema = {
  gym_done: { t: "bool" }, gym_minutes: { t: "int", min: 0, max: 600, nullable: true },
  sleep_hours: { t: "num", min: 0, max: 24, nullable: true }, mood: { t: "int", min: 1, max: 5, nullable: true }, energy: { t: "int", min: 1, max: 5, nullable: true },
  job_applications: { t: "int", min: 0, max: 100 }, referrals_sent: { t: "int", min: 0, max: 100 }, revision_done: { t: "bool" },
  notes: { t: "str", nullable: true },
};

function checkinOut(date: string) {
  const checkin = db.query("SELECT * FROM checkins WHERE date=?").get(date) as any;
  const study = db.query("SELECT subject_id, minutes, source FROM study_minutes WHERE date=? ORDER BY subject_id, source").all(date) as any[];
  const effective = db.query('SELECT subject_id,minutes,source FROM effective_study_minutes WHERE date=? ORDER BY subject_id').all(date) as any[];
  return { date, checkin, study_minutes: study, effective_study_minutes: effective,
    study_minutes_total: effective.reduce((s, x) => s + x.minutes, 0), job_minutes: jobMinutes(date), job_counts: jobCounts(date) };
}

/** Upsert (fields not supplied keep their previous value). study_minutes {subject_id: minutes} writes source='manual'. */
export function saveCheckin(date: string, body: any) {
  const p = parse(body, CHECKIN, true);
  const sm = body.study_minutes;
  if (sm !== undefined && (sm === null || typeof sm !== "object" || Array.isArray(sm))) throw new ApiError(422, "validation", "study_minutes must be {subject_id: minutes}");
  db.transaction(() => {
    if (!db.query("SELECT 1 FROM checkins WHERE date=?").get(date)) db.run("INSERT INTO checkins(date,updated_at) VALUES (?,?)", [date, now()]);
    const cols = Object.keys(p);
    if (cols.length) db.run(`UPDATE checkins SET ${cols.map(k => `${k}=?`).join(",")}, updated_at=? WHERE date=?`, [...cols.map(k => bind(p[k])), now(), date]);
    else db.run("UPDATE checkins SET updated_at=? WHERE date=?", [now(), date]);
    for (const [sid, m] of Object.entries(sm ?? {})) {
      const mins = Number(m);
      if (!Number.isInteger(mins) || mins < 0) throw new ApiError(422, "validation", `study_minutes.${sid} must be a non-negative integer`);
      if (!db.query("SELECT 1 FROM subjects WHERE id=?").get(sid)) throw new ApiError(422, "validation", `unknown subject ${sid}`);
      if (mins === 0) db.run("DELETE FROM study_minutes WHERE date=? AND subject_id=? AND source='manual'", [date, sid]);
      else db.run("INSERT INTO study_minutes(date,subject_id,minutes,source,updated_at) VALUES (?,?,?,'manual',?) ON CONFLICT(date,subject_id,source) DO UPDATE SET minutes=excluded.minutes, updated_at=excluded.updated_at", [date, sid, mins, now()]);
    }
  })();
  sweepAutoTasks(date);
}

export function checkinRoutes() {
  const r = new Hono<Env>();

  r.get("/checkins", (c) => {
    const to = dateParam(c.req.query("to"), "to", todayIST()), from = dateParam(c.req.query("from"), "from", addDays(to, -29));
    const { limit, offset } = paging(k => c.req.query(k));
    const rows = db.query(`SELECT k.*, COALESCE((SELECT SUM(minutes) FROM effective_study_minutes s WHERE s.date=k.date),0) AS study_minutes_total
      FROM checkins k WHERE date BETWEEN ? AND ? ORDER BY date DESC LIMIT ? OFFSET ?`).all(from, to, limit + 1, offset);
    return c.json(page(rows, limit, offset));
  });
  r.get("/checkins/:date", (c) => c.json(checkinOut(dateParam(c.req.param("date"), "date"))));

  /** Upsert (fields not supplied keep their previous value). study_minutes {subject_id: minutes} writes source='manual'. */
  r.put("/checkins/:date", async (c) => {
    const date = dateParam(c.req.param("date"), "date");
    saveCheckin(date, await readJson(c));
    return c.json({ ...checkinOut(date), streaks: computeStreaks() });
  });

  r.get("/streaks", (c) => c.json(computeStreaks()));

  /** Joined daily view for Claude. */
  r.get("/log", (c) => {
    const to = dateParam(c.req.query("to"), "to", todayIST()), from = dateParam(c.req.query("from"), "from", addDays(to, -6));
    if (diffDays(from, to) > 92 || from > to) throw new ApiError(400, "validation", "range must be 0..92 days");
    const today = todayIST();
    const out: any[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const tasks = db.query("SELECT id,title,type,subject_id,topic_id,est_minutes,done_minutes,priority,status,carry_count,fixed FROM plan_tasks WHERE date=? AND deleted_at IS NULL ORDER BY sort").all(d) as any[];
      const att = db.query("SELECT COUNT(*) n, COALESCE(SUM(correct),0) c, COALESCE(SUM(time_s),0) t FROM attempts WHERE date(at,'+330 minutes')=?").get(d) as any;
      out.push({
        date: d,
        checkin: db.query("SELECT * FROM checkins WHERE date=?").get(d) ?? null,
        study_minutes: db.query("SELECT subject_id, minutes, source FROM effective_study_minutes WHERE date=?").all(d),
        tasks_done: tasks.filter(t => t.status === "done"),
        tasks_missed: d < today ? tasks.filter(t => ["todo", "doing", "moved", "skipped"].includes(t.status) && !t.fixed) : [],
        tasks_open: d >= today ? tasks.filter(t => ["todo", "doing"].includes(t.status)) : [],
        attempts: { count: att.n, correct: att.c, time_s: att.t },
        cards_reviewed: (db.query("SELECT COUNT(*) n FROM card_reviews WHERE date(at,'+330 minutes')=?").get(d) as any).n,
        mistakes_reviewed: (db.query("SELECT COUNT(*) n FROM mistakes WHERE last_reviewed_on=?").get(d) as any).n,
      });
    }
    return c.json({ from, to, days: out });
  });
  return r;
}
