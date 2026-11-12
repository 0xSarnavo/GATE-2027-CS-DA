/**
 * Seed loader (idempotent: INSERT OR IGNORE everywhere, so re-running never overwrites edits).
 *   bun run seed            -> loads into DATA_DIR (default app/.data)
 * Sources: CONTENT_DIR/topics.json (seed/topics.json fallback), profiles/owner/plan.json, CONTENT_DIR/questions/*.json (files starting with '_' are skipped).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { db } from "../server/db";
import { config } from "../server/config";
import { now, todayIST, addDays } from "../server/util";

const here = import.meta.dir;
const appRoot = resolve(here, "..");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const ins = (sql: string, params: any[]) => db.run(sql, params).changes;
const r5 = (n: number) => Math.round(n / 5) * 5;
const c5 = (n: number) => Math.ceil(n / 5) * 5;
const STUDY = new Set(["study", "pyq", "revision", "mock", "GA"]);
const scopeOf = (p: string) => (p === "CS" ? "cs" : p === "DA" ? "da" : "shared");
const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();

export function runSeed({ includeOwnerPlan = true }: { includeOwnerPlan?: boolean } = {}) {
  const t = now();
  const counts: Record<string, number> = {};
  const add = (k: string, n: number) => (counts[k] = (counts[k] ?? 0) + n);

  db.transaction(() => {
    // ---------------------------------------------------------- subjects, topics, videos
    const topicFile = join(config.contentDir, "topics.json");
    const topics: any[] = read(existsSync(topicFile) ? topicFile : join(here, "topics.json"));
    const byId = new Map(topics.map(x => [x.id, x]));
    const rootOf = (id: string): string => { let x = byId.get(id); while (x?.parent_id) x = byId.get(x.parent_id); return x?.id ?? id; };
    add("subjects", ins("INSERT OR IGNORE INTO subjects(id,name,scope,sort) VALUES ('general','General / unsorted','shared',999)", []));
    topics.filter(x => !x.parent_id).forEach((x, i) => add("subjects", ins("INSERT OR IGNORE INTO subjects(id,name,scope,sort) VALUES (?,?,?,?)", [x.id, x.name, scopeOf(x.paper), i])));
    add("topics", ins("INSERT OR IGNORE INTO topics(id,subject_id,parent_id,name,scope,sort,notes,updated_at,created_by) VALUES ('general.unsorted','general',NULL,'Unsorted (awaiting topic tags)','shared',0,'Raw imported questions land here until enrichment assigns a topic.',?, 'seed')", [t]));
    // parents before children
    const sortedTopics = [...topics].sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0));
    const order = new Map(topics.map((x, i) => [x.id, i]));
    for (const x of sortedTopics)
      add("topics", ins("INSERT OR IGNORE INTO topics(id,subject_id,parent_id,name,scope,sort,notes,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?, 'seed')",
        [x.id, rootOf(x.id), x.parent_id ?? null, x.name, scopeOf(x.paper), order.get(x.id), x.syllabus_text ?? null, t]));
    db.run("UPDATE subjects SET scope_override='foundation' WHERE id='found'");
    db.run("UPDATE topics SET scope_override='foundation' WHERE id='found' OR parent_id='found'");
    for (const x of topics) (x.videos ?? []).forEach((v: any, i: number) =>
      add("videos", ins("INSERT OR IGNORE INTO videos(id,topic_id,subject_id,title,url,source,role,language,sort,updated_at,created_by) VALUES (?,?,?,?,?,?,'concept',?,?,?, 'seed')",
        [`v-${x.id}-${i}`, x.id, rootOf(x.id), v.title ?? null, v.url, (v.title ?? "").split(" - ")[0] || null, v.lang ?? "en", i, t])));

    // ---------------------------------------------------------- plan
    const plan = includeOwnerPlan ? read(join(appRoot, "profiles", "owner", "plan.json")) : { phases: [], weeks: [], days: [] };
    const phases: any[] = plan.phases, weeks: any[] = plan.weeks;
    for (const p of phases) add("phases", ins("INSERT OR IGNORE INTO phases(id,name,start_date,end_date,description,updated_at) VALUES (?,?,?,?,?,?)", [p.id, p.name, p.start, p.end, p.description ?? null, t]));
    const weekFor = (d: string) => weeks.find(w => w.start <= d && d <= w.end);
    for (const w of weeks) {
      const goals = (w.macro_goals ?? []).map((g: any, i: number) => ({ ...g, id: `w${w.week_no}-g${i + 1}`, done: false }));
      add("weeks", ins("INSERT OR IGNORE INTO weeks(id,phase_id,week_no,start_date,end_date,title,macro_goals,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        [`w${w.week_no}`, w.phase_id, w.week_no, w.start, w.end, w.label ?? null, JSON.stringify(goals), t]));
    }
    const wd = Number(db.query("SELECT value FROM settings WHERE key='weekday_study_minutes'").get() ? (db.query("SELECT value FROM settings WHERE key='weekday_study_minutes'").get() as any).value : 390);
    const we = Number((db.query("SELECT value FROM settings WHERE key='weekend_study_minutes'").get() as any)?.value ?? 300);
    let skippedCheckins = 0;
    for (const day of plan.days) {
      const w = weekFor(day.date);
      if (!w) throw new Error(`plan day ${day.date} is not covered by any week`);
      const tasks = day.tasks.map((x: any, idx: number) => ({ x, idx }));
      const norm = tasks.filter(({ x }: any) => x.type !== "checkin").map(({ x, idx }: any) => {
        let type: string = x.type === "flashcards" ? "revision" : x.type;
        if (x.subject === "GA" && ["study", "pyq", "revision"].includes(type)) type = "GA";
        const fixed = type === "job" || type === "gym" ? 1 : 0;
        const min = fixed || type === "mock" ? null : Math.max(15, r5(x.minutes * (x.priority === 1 ? 0.75 : 0.5)));
        const topicRoot = x.topic_id ? byId.get(x.topic_id) && rootOf(x.topic_id) : null;
        const subject_id = topicRoot ?? (x.subject === "GA" ? "ga" : null);
        return { id: `seed-${day.date}-${String(idx).padStart(2, "0")}`, type, fixed, min, subject_id, x };
      });
      skippedCheckins += tasks.length - norm.length;
      const planned = norm.filter((n: any) => !n.fixed && STUDY.has(n.type)).reduce((s: number, n: any) => s + n.x.minutes, 0);
      const dflt = dow(day.date) === 0 || dow(day.date) === 6 ? we : wd;
      const avail = planned > dflt ? c5(planned) : null;
      const kind = norm.some((n: any) => n.type === "mock") ? "mock" : "normal";
      add("plan_days", ins("INSERT OR IGNORE INTO plan_days(date,week_id,available_minutes,day_kind,updated_at) VALUES (?,?,?,?,?)", [day.date, `w${w.week_no}`, avail, kind, t]));
      norm.forEach((n: any, i: number) => add("plan_tasks", ins(
        `INSERT OR IGNORE INTO plan_tasks(id,date,sort,title,subject_id,topic_id,type,est_minutes,min_minutes,priority,fixed,status,done_minutes,origin_date,updated_at,time_block,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'todo',0,?,?,?, 'seed')`,
        [n.id, day.date, i + 1, n.x.title, n.subject_id, n.x.topic_id ?? null, n.type, n.x.minutes, n.min, n.x.priority, n.fixed, day.date, t, n.x.time_block ?? null])));
    }
    counts["checkin_tasks_skipped"] = skippedCheckins;

    // ---------------------------------------------------------- raw questions
    const qdir = join(config.contentDir, "questions");
    for (const f of (existsSync(qdir) ? readdirSync(qdir) : []).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort()) {
      for (const q of read(join(qdir, f)) as any[]) {
        let answer = "";
        if (Array.isArray(q.answer)) answer = [...q.answer].sort().join(",");
        else if (q.answer && typeof q.answer === "object") answer = (q.answer.ranges as number[][]).map(r => (r[0] === r[1] ? String(r[0]) : `${r[0]}..${r[1]}`)).join("|");
        else if (q.answer != null) answer = String(q.answer);
        const opts = Array.isArray(q.options) && q.options.length ? JSON.stringify(q.options.map((o: any, i: number) => ({ key: "ABCDEFGH"[i], text: String(o) }))) : null;
        const topic = q.section === "GA" ? "ga" : "general.unsorted";
        add("questions", ins(
          `INSERT OR IGNORE INTO questions(id,source,paper,year,session,q_no,topic_id,type,marks,stem,options,answer,difficulty,image_refs,pdf_ref,needs_review,created_by,created_at,updated_at)
           VALUES (?, 'official', ?,?,?,?,?,?,?,?,?,?,3,?,?,?, 'import', ?, ?)`,
          [q.id, q.paper, q.exam_year, q.session, String(q.q_no), topic, q.q_type, q.marks >= 2 ? 2 : 1, q.text ?? "", opts, answer,
            JSON.stringify(q.image ? [q.image] : []), q.source_pdf ? `${q.source_pdf}#p${(q.source_pages ?? []).join(",")}` : null,
            q.needs_review || !answer ? 1 : 0, t, t]));
      }
    }
  })();
  if (includeOwnerPlan) counts.foundation_plan = seedFoundationPlan();
  return counts;
}

/** Add newly shipped seed topics to an existing database without touching plans or edits. */
export function seedMissingTopics() {
  const path = join(here, "topics.json");
  const topics: any[] = read(path);
  const t = now();
  return db.transaction(() => {
    let added = 0;
    for (const [i, x] of topics.entries()) {
      if (x.parent_id) continue;
      added += ins("INSERT OR IGNORE INTO subjects(id,name,scope,sort,scope_override) VALUES (?,?,?,?,?)", [x.id, x.name, scopeOf(x.paper), i, x.scope === "foundation" ? "foundation" : null]);
    }
    for (const [i, x] of topics.entries()) {
      const root = x.parent_id ?? x.id;
      added += ins("INSERT OR IGNORE INTO topics(id,subject_id,parent_id,name,scope,sort,notes,updated_at,created_by,scope_override) VALUES (?,?,?,?,?,?,?,?, 'seed',?)",
        [x.id, root, x.parent_id ?? null, x.name, scopeOf(x.paper), i, x.syllabus_text ?? null, t, x.scope === "foundation" ? "foundation" : null]);
    }
    db.run("UPDATE subjects SET scope_override='foundation' WHERE id='found' AND scope_override IS NULL");
    db.run("UPDATE topics SET scope_override='foundation' WHERE (id='found' OR parent_id='found') AND scope_override IS NULL");
    return added;
  })();
}

/** Fill only missing, future plan tasks; user edits and completed tasks survive reruns. */
export function seedFoundationPlan() {
  if (!db.query("SELECT 1 FROM weeks WHERE id='w1'").get()) return 0;
  const first = "2026-10-08", last = "2026-11-15";
  const track = ["algebra", "functions", "explog", "trig", "limits_intuition", "derivatives", "integrals", "series", "fractions_percent", "vectors_matrices", "binary"].map(x => `found.${x}`);
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  const tomorrow = addDays(todayIST(), 1), t = now();
  return db.transaction(() => {
    let added = 0;
    const insTask = db.query(`INSERT OR IGNORE INTO plan_tasks(id,date,sort,title,subject_id,topic_id,type,est_minutes,min_minutes,priority,status,origin_date,updated_at,created_by)
      VALUES (?,?,?,?,?,?,'study',?,?,1,'todo',?,?,'seed')`);
    days.forEach((date, i) => {
      if (date < tomorrow || !db.query("SELECT 1 FROM plan_days WHERE date=?").get(date)) return;
      const id = track[Math.floor(i * track.length / days.length)]!;
      const name = (db.query("SELECT name FROM topics WHERE id=?").get(id) as any)?.name;
      if (name) added += insTask.run(`found-daily-${date}`, date, -900, `Foundation · 30 min: ${name}`, "found", id, 30, 15, date, t).changes;
    });
    const weeks = db.query("SELECT id,start_date,end_date FROM weeks WHERE start_date>? ORDER BY start_date").all(last) as { id: string; start_date: string; end_date: string }[];
    for (const week of weeks) {
      if (week.start_date < tomorrow || !db.query("SELECT 1 FROM plan_days WHERE date=?").get(week.start_date)) continue;
      const chapters = db.query(`SELECT DISTINCT p.topic_id AS id,t.name FROM plan_tasks p JOIN topics t ON t.id=p.topic_id
        WHERE p.date BETWEEN ? AND ? AND p.type IN ('study','pyq') AND t.parent_id IS NOT NULL AND t.parent_id<>'found' AND p.deleted_at IS NULL ORDER BY p.date,p.sort`).all(week.start_date, week.end_date) as { id: string; name: string }[];
      chapters.forEach((chapter, i) => { added += insTask.run(`found-readiness-${week.id}-${chapter.id}`, week.start_date, -800 + i, `Readiness check: ${chapter.name}`, chapter.id.split('.')[0], chapter.id, 2, 2, week.start_date, t).changes; });
    }
    return added;
  })();
}

if (import.meta.main) {
  console.log(`seeding ${config.dataDir}/gate.db`);
  console.log(runSeed());
  for (const t of ["subjects", "topics", "videos", "phases", "weeks", "plan_days", "plan_tasks", "questions"])
    console.log(t.padEnd(12), (db.query(`SELECT COUNT(*) n FROM ${t}`).get() as any).n);
}
