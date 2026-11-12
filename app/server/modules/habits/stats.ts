import { Hono } from "hono";
import { db } from "../../db";
import type { Env } from "../../auth";
import { addDays, dateParam, todayIST } from "../../util";
import { capOf } from "../../lib/scheduler";
import { computeStreaks, settingsObj } from "../../lib/services";

export function statsRoutes() {
  const r = new Hono<Env>();
  r.get("/stats/overview", (c) => {
    const today = todayIST();
    const to = dateParam(c.req.query("to"), "to", today), from = dateParam(c.req.query("from"), "from", addDays(to, -29));
    const s = settingsObj();
    const A = "date(a.at,'+330 minutes') BETWEEN ? AND ?";
    const by_subject = db.query(`SELECT m.subject_id, s.name, SUM(m.minutes) minutes FROM effective_study_minutes m JOIN subjects s ON s.id=m.subject_id WHERE m.date BETWEEN ? AND ? GROUP BY m.subject_id ORDER BY minutes DESC`).all(from, to);
    const by_day = db.query("SELECT date, SUM(minutes) minutes FROM effective_study_minutes WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date").all(from, to);
    const acc = (sel: string, join: string, group: string) => db.query(`SELECT ${sel}, COUNT(*) attempts, SUM(a.correct) correct, ROUND(100.0*SUM(a.correct)/COUNT(*),1) accuracy
      FROM attempts a JOIN questions q ON q.id=a.question_id ${join} WHERE ${A} GROUP BY ${group} ORDER BY attempts DESC`).all(from, to);
    const accuracy_by_topic = acc("q.topic_id, t.name", "JOIN topics t ON t.id=q.topic_id", "q.topic_id");
    const accuracy_by_difficulty = acc("q.difficulty", "", "q.difficulty").sort((a: any, b: any) => a.difficulty - b.difficulty);
    const avg_time_by_type = db.query(`SELECT q.type, ROUND(AVG(a.time_s),1) avg_time_s, COUNT(*) attempts FROM attempts a JOIN questions q ON q.id=a.question_id WHERE ${A} AND a.time_s IS NOT NULL GROUP BY q.type`).all(from, to);
    const error_type_counts = db.query(`SELECT COALESCE(a.error_type,'unspecified') error_type, COUNT(*) n FROM attempts a WHERE a.correct=0 AND ${A} GROUP BY 1 ORDER BY n DESC`).all(from, to);
    const mocks = (db.query("SELECT date,paper,label,raw_score,max_score,accuracy_percent,attempted_marks FROM mocks WHERE deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date").all(from, to) as any[]);
    const mock_trend = { CS: mocks.filter(m => m.paper === "CS"), DA: mocks.filter(m => m.paper === "DA") };

    // plan adherence (planned = live study-type tasks up to `to`)
    const wk = db.query(`SELECT w.id week_id, w.start_date, w.title,
        COALESCE(SUM(CASE WHEN t.status IN ('todo','doing','done') THEN t.est_minutes END),0) planned_min,
        COALESCE(SUM(CASE WHEN t.status='done' THEN CASE WHEN t.done_minutes>0 THEN t.done_minutes ELSE t.est_minutes END END),0) done_min
      FROM weeks w LEFT JOIN plan_tasks t ON t.date BETWEEN w.start_date AND w.end_date AND t.date BETWEEN ? AND ? AND t.deleted_at IS NULL AND t.fixed=0 AND t.type IN ('study','pyq','revision','mock','GA')
      WHERE w.end_date>=? AND w.start_date<=? GROUP BY w.id ORDER BY w.start_date`).all(from, to, from, to) as any[];
    for (const w of wk) w.done_min = (db.query('SELECT COALESCE(SUM(minutes),0) n FROM effective_study_minutes WHERE date BETWEEN ? AND ?').get(w.start_date < from ? from : w.start_date, w.end_date > to ? to : w.end_date) as any).n;
    const plan_adherence = { planned_min: wk.reduce((a, x) => a + x.planned_min, 0), done_min: wk.reduce((a, x) => a + x.done_min, 0), by_week: wk };

    const weak = db.query(`WITH last AS (SELECT a.question_id, a.correct, ROW_NUMBER() OVER (PARTITION BY a.question_id ORDER BY a.at DESC) rn FROM attempts a)
      SELECT q.topic_id, t.name, COUNT(*) attempts, SUM(l.correct) correct,
        (SELECT COUNT(*) FROM mistakes m JOIN questions mq ON mq.id=m.question_id WHERE mq.topic_id=q.topic_id AND m.status='open') open_mistakes
      FROM last l JOIN questions q ON q.id=l.question_id JOIN topics t ON t.id=q.topic_id WHERE l.rn=1 GROUP BY q.topic_id`).all() as any[];
    const weak_topics = weak.map(w => {
      const accuracy = w.attempts ? w.correct / w.attempts : 1;
      return { topic_id: w.topic_id, name: w.name, accuracy: Math.round(accuracy * 1000) / 10, attempts: w.attempts, open_mistakes: w.open_mistakes, score: Math.round((1 - accuracy) * 100 + w.open_mistakes * 5) };
    }).filter(w => (w.attempts >= 3 && w.accuracy < 100) || w.open_mistakes > 0).sort((a, b) => b.score - a.score).slice(0, 10);

    const cov = (scope: "cs" | "da") => {
      const r = db.query(`SELECT COUNT(*) total, SUM(COALESCE(p.status,'todo')!='todo') started, SUM(COALESCE(p.status,'todo') IN ('revised','mastered')) done
        FROM topics t LEFT JOIN topic_progress p ON p.topic_id=t.id WHERE t.deleted_at IS NULL AND t.scope IN ('shared', ?) AND t.parent_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id=t.id AND k.deleted_at IS NULL)`).get(scope) as any;
      return { total: r.total, started: r.started ?? 0, done: r.done ?? 0, pct: r.total ? Math.round(1000 * (r.done ?? 0) / r.total) / 10 : 0 };
    };
    const hf = addDays(today, -111);
    const heat = new Map<string, any>();
    for (let d = hf; d <= today; d = addDays(d, 1)) heat.set(d, { date: d, study_minutes: 0, gym: 0, revision: 0, job: 0 });
    for (const x of db.query("SELECT date, SUM(minutes) m FROM effective_study_minutes WHERE date>=? GROUP BY date").all(hf) as any[]) heat.get(x.date) && (heat.get(x.date).study_minutes = x.m);
    for (const x of db.query("SELECT date, gym_done, revision_done, job_applications FROM checkins WHERE date>=?").all(hf) as any[]) { const h = heat.get(x.date); if (h) { h.gym = x.gym_done; h.revision = x.revision_done; h.job = x.job_applications; } }

    return c.json({
      range: { from, to }, study_minutes_by_subject: by_subject, by_day, accuracy_by_topic, accuracy_by_difficulty, avg_time_by_type, error_type_counts, mock_trend,
      plan_adherence, weak_topics, days_to_exam: Math.round((Date.parse((s.exam_date ?? today) + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000),
      syllabus_coverage: { cs: cov("cs"), da: cov("da") }, streaks: computeStreaks(today), heatmap: [...heat.values()],
    });
  });
  void capOf;
  return r;
}
