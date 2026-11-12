import { Hono } from "hono";
import type { Env } from "../../auth";
import { crud } from "../../routes/crud";
import type { Schema } from "../../validate";
import { db } from '../../db';
import { now, todayIST } from '../../util';
import { jobCounts, jobMinutes, sweepAutoTasks } from '../planner/auto';
export const JOB: Schema = {
  company: { t: "str", req: true }, role: { t: "str", nullable: true }, url: { t: "str", nullable: true }, date_applied: { t: "date", nullable: true },
  person_contacted: { t: "str", nullable: true }, response: { t: "str", nullable: true }, next_follow_up: { t: "date", nullable: true }, notes: { t: "str", nullable: true },
};

export function jobRoutes() {
  const r = new Hono<Env>();
  r.use('*', async (c, next) => {
    const date = !['GET', 'HEAD'].includes(c.req.method) ? (await c.req.raw.clone().json().catch(() => null))?.date_applied : null;
    await next();
    if (c.res.status >= 200 && c.res.status < 300 && typeof date === 'string' && /^\d{4}-\d\d-\d\d$/.test(date)) sweepAutoTasks(date);
  });
  r.get('/jobs/today', c => { const date = todayIST(); return c.json({ date, ...jobCounts(date), minutes: jobMinutes(date) }); });
  r.post('/jobs/outreach', c => {
    const date = todayIST();
    db.run('INSERT INTO checkins(date,referrals_sent,updated_at) VALUES (?,1,?) ON CONFLICT(date) DO UPDATE SET referrals_sent=referrals_sent+1,updated_at=excluded.updated_at', [date, now()]);
    sweepAutoTasks(date);
    return c.json({ date, ...jobCounts(date), minutes: jobMinutes(date) });
  });
  r.route("/", crud({ table: "jobs", path: "/jobs", schema: JOB, bulkKey: "jobs", order: "COALESCE(date_applied,'') DESC, id", filters: { response: "response=?", follow_up_before: "next_follow_up<=?" } }));
  return r;
}
