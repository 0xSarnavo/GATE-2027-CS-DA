import { config } from "../config";
import { db } from "../db";
import { ApiError, notFound } from "../errors";
import { addDays, hydrate, istDate, now, uuid, todayIST, diffDays } from "../util";
import { grade } from "./grading";
import { sm2, gameGrade } from "./sm2";
import { computeStreak } from "./streaks";
import { reschedule, STUDY_TYPES, type Change, type Result, type SState, type STask, type Trigger } from "./scheduler";
import type { Actor } from "../auth";

export function settingsObj(): Record<string, string> {
  const o: Record<string, string> = { daily_question_goal: "30" };
  for (const r of db.query("SELECT key,value FROM settings").all() as any[]) o[r.key] = r.value;
  return o;
}
export const getSetting = (k: string, d = "") => (db.query("SELECT value FROM settings WHERE key=?").get(k) as any)?.value ?? d;
export function setSetting(k: string, v: string) {
  db.run("INSERT INTO settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", [k, v, now()]);
}
export const createdBy = (actor: Actor) => (actor === "claude" ? "claude" : "user");

// ---------------------------------------------------------------- study minutes
export function recomputeTaskMinutes(date: string) {
  db.run("DELETE FROM study_minutes WHERE date=? AND source='task'", [date]);
  const rows = db.query(`SELECT COALESCE(subject_id,'general') AS sid,
      SUM(CASE WHEN status='done' THEN CASE WHEN done_minutes>0 THEN done_minutes ELSE est_minutes END ELSE done_minutes END) AS m
    FROM plan_tasks WHERE date=? AND deleted_at IS NULL AND fixed=0 AND type IN ('study','pyq','revision','mock','GA') GROUP BY sid`).all(date) as any[];
  for (const r of rows) if (r.m > 0)
    db.run("INSERT INTO study_minutes(date,subject_id,minutes,source,updated_at) VALUES (?,?,?,'task',?)", [date, r.sid, r.m, now()]);
}
export function recomputeAttemptMinutes(date: string) {
  db.run("DELETE FROM study_minutes WHERE date=? AND source='attempts'", [date]);
  const rows = db.query(`SELECT t.subject_id AS sid, SUM(a.time_s) AS s FROM attempts a JOIN questions q ON q.id=a.question_id JOIN topics t ON t.id=q.topic_id
    WHERE date(a.at,'+330 minutes')=? GROUP BY t.subject_id`).all(date) as any[];
  for (const r of rows) { const m = Math.round((r.s ?? 0) / 60); if (m > 0) db.run("INSERT INTO study_minutes(date,subject_id,minutes,source,updated_at) VALUES (?,?,?,'attempts',?)", [date, r.sid, m, now()]); }
}

// ---------------------------------------------------------------- tasks
export function getTask(id: string) {
  const t = db.query("SELECT * FROM plan_tasks WHERE id=? AND deleted_at IS NULL").get(id) as any;
  if (!t) throw notFound("task");
  return t;
}
export function completeTask(id: string, doneMinutes?: number) {
  const t = getTask(id);
  const dm = doneMinutes ?? (t.done_minutes > 0 ? Math.max(t.done_minutes, 0) : t.est_minutes);
  db.run("UPDATE plan_tasks SET status='done', done_minutes=?, auto_done=0, auto_reason=NULL, auto_undone_at=NULL, completed_at=?, updated_at=? WHERE id=?", [dm, now(), now(), id]);
  recomputeTaskMinutes(t.date);
  if (t.topic_id) db.run(`INSERT INTO topic_progress(topic_id,status,last_studied_on,updated_at) VALUES (?, 'todo', ?, ?)
    ON CONFLICT(topic_id) DO UPDATE SET last_studied_on=excluded.last_studied_on, updated_at=excluded.updated_at`, [t.topic_id, t.date, now()]);
  return getTask(id);
}
export function ensurePlanDay(date: string) {
  if (db.query("SELECT 1 FROM plan_days WHERE date=?").get(date)) return;
  const w = db.query("SELECT id FROM weeks WHERE start_date<=? AND end_date>=?").get(date, date) as any;
  if (!w) throw new ApiError(422, "validation", `no plan week covers ${date}; create the week first`);
  db.run("INSERT INTO plan_days(date,week_id,day_kind,updated_at) VALUES (?,?, 'normal', ?)", [date, w.id, now()]);
}
export function nextSort(date: string): number {
  return ((db.query("SELECT MAX(sort) m FROM plan_tasks WHERE date=?").get(date) as any).m ?? 0) + 1;
}
export function logRevision(actor: string, reason: string, diff: any): string {
  const id = uuid();
  db.run("INSERT INTO plan_revisions(id,at,actor,reason,diff) VALUES (?,?,?,?,?)", [id, now(), actor, reason, JSON.stringify(diff)]);
  return id;
}

// ---------------------------------------------------------------- scheduler glue
export function loadSchedState(today: string, weekDate?: string, until?: string): SState {
  const s = settingsObj();
  const from = addDays(today, -60), to = until && until > addDays(today, 28) ? until : addDays(today, 28);
  const days = (db.query(`SELECT d.date, d.week_id, d.available_minutes, d.day_kind, p.id pid FROM plan_days d
      JOIN weeks w ON w.id=d.week_id JOIN phases p ON p.id=w.phase_id WHERE d.date BETWEEN ? AND ? ORDER BY d.date`).all(from, to) as any[])
    .map(d => ({ date: d.date, week_id: d.week_id, available_minutes: d.available_minutes, day_kind: d.day_kind, redistribute: d.day_kind !== "light" && d.day_kind !== "off" && !(config.profileRules.noRedistributePhaseIds ?? []).includes(d.pid) }));
  const tasks = db.query(`SELECT id,date,sort,title,type,est_minutes,min_minutes,priority,fixed,status,done_minutes,carry_count,origin_date
    FROM plan_tasks WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`).all(from, to) as STask[];
  let weekId: string | undefined;
  if (weekDate) weekId = days.find(d => d.date === weekDate)?.week_id ?? (db.query("SELECT id FROM weeks WHERE start_date<=? AND end_date>=?").get(weekDate, weekDate) as any)?.id;
  return {
    today, days, tasks, weekId,
    weekdayMinutes: Number(s.weekday_study_minutes ?? s.default_study_minutes ?? 180),
    weekendMinutes: Number(s.weekend_study_minutes ?? 300),
    newId: () => uuid(),
  };
}

const SNAP = ["status", "date", "est_minutes", "carry_count", "origin_date", "sort"] as const;
const snap = (t: any) => Object.fromEntries(SNAP.map(k => [k, t[k]]));

/** Apply scheduler changes in one transaction + audit row. Returns revision id (null if no changes). */
export function applyResult(res: Result, actor: string, reason: string): string | null {
  if (!res.changes.length && !res.week_notes.length) return null;
  const diff: any = { added: [], changed: [], removed: [], overflow: res.overflow, warnings: res.warnings, changes: res.changes };
  let revId: string | null = null;
  db.transaction(() => {
    const touched = new Set<string>();
    const changed = new Map<string, { id: string; before: any; after?: any }>();
    const chg = (t: any) => { if (!changed.has(t.id)) changed.set(t.id, { id: t.id, before: snap(t) }); };
    for (const c of res.changes) {
      const t = getTask(c.task_id);
      touched.add(t.date); if (c.to) touched.add(c.to);
      if (c.op === "skip") { chg(t); db.run("UPDATE plan_tasks SET status='skipped', updated_at=? WHERE id=?", [now(), t.id]); }
      else if (c.op === "resize") { chg(t); db.run("UPDATE plan_tasks SET est_minutes=?, updated_at=? WHERE id=?", [c.est_minutes, now(), t.id]); }
      else if (c.op === "move") {
        chg(t);
        db.run("UPDATE plan_tasks SET date=?, sort=?, carry_count=carry_count+?, origin_date=COALESCE(origin_date,?), updated_at=? WHERE id=?",
          [c.to, nextSort(c.to!), c.carry_inc === 0 ? 0 : 1, t.date, now(), t.id]);
      } else {
        chg(t);
        db.run("UPDATE plan_tasks SET status='moved', updated_at=? WHERE id=?", [now(), t.id]);
        const row = {
          id: c.new_task_id!, date: c.to, sort: nextSort(c.to!), title: t.title, subject_id: t.subject_id, topic_id: t.topic_id, type: t.type,
          est_minutes: c.est_minutes, min_minutes: t.min_minutes == null ? null : Math.min(t.min_minutes, c.est_minutes), priority: t.priority, fixed: 0,
          status: "todo", done_minutes: 0, carried_over_from: t.id, carry_count: t.carry_count + 1, origin_date: t.origin_date ?? t.date,
          updated_at: now(), time_block: t.time_block, created_by: "scheduler",
        };
        const cols = Object.keys(row);
        db.run(`INSERT INTO plan_tasks(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, cols.map(k => (row as any)[k]));
        diff.added.push(row);
      }
    }
    for (const v of changed.values()) { v.after = snap(getTask(v.id)); diff.changed.push(v); }
    for (const n of res.week_notes) {
      const w = db.query("SELECT review_notes FROM weeks WHERE id=?").get(n.week_id) as any;
      const notes = (w?.review_notes ? w.review_notes + "\n" : "") + n.line;
      db.run("UPDATE weeks SET review_notes=?, updated_at=? WHERE id=?", [notes, now(), n.week_id]);
    }
    for (const d of touched) recomputeTaskMinutes(d);
    revId = logRevision(actor, reason, diff);
  })();
  return revId;
}

export function undoRevision(id: string, actor: string) {
  const rev = db.query("SELECT * FROM plan_revisions WHERE id=?").get(id) as any;
  if (!rev) throw notFound("revision");
  const diff = JSON.parse(rev.diff);
  if (diff.undone_at) throw new ApiError(409, "conflict", "revision already undone");
  if (!diff.changed && !diff.added && !diff.removed) throw new ApiError(422, "validation", "revision has no reversible diff");
  let restored = 0, removed = 0;
  db.transaction(() => {
    for (const t of diff.added ?? []) { db.run("UPDATE plan_tasks SET deleted_at=?, updated_at=? WHERE id=?", [now(), now(), t.id]); removed++; }
    for (const rid of diff.removed ?? []) { db.run("UPDATE plan_tasks SET deleted_at=NULL, updated_at=? WHERE id=?", [now(), rid]); restored++; }
    for (const c of diff.changed ?? []) {
      if (!c.before) continue;
      db.run("UPDATE plan_tasks SET status=?, date=?, est_minutes=?, carry_count=?, origin_date=?, sort=?, updated_at=? WHERE id=?",
        [c.before.status, c.before.date, c.before.est_minutes, c.before.carry_count, c.before.origin_date, c.before.sort, now(), c.id]); restored++;
      recomputeTaskMinutes(c.before.date);
    }
    if (diff.capacity) db.query("UPDATE plan_days SET available_minutes=?,updated_at=? WHERE date=?").run(diff.capacity.before, now(), diff.capacity.date);
    diff.undone_at = now();
    db.run("UPDATE plan_revisions SET diff=? WHERE id=?", [JSON.stringify(diff), id]);
    logRevision(actor, `undo of revision ${id}`, { undo_of: id, restored, removed });
  })();
  return { revision_id: id, restored, removed };
}

export function runReschedule(trigger: Trigger, opts: { today?: string; weekDate?: string; dry?: boolean; actor: string; reason?: string }) {
  const today = opts.today ?? todayIST();
  const anchor = trigger.kind === "capacity" ? trigger.date : opts.weekDate;
  const state = loadSchedState(today, opts.weekDate, anchor ? addDays(anchor, 16) : undefined);
  const res = reschedule(state, trigger);
  const revision_id = opts.dry ? null : applyResult(res, opts.actor, opts.reason ?? `${trigger.kind}${trigger.kind === "capacity" ? " " + trigger.date + "=" + trigger.minutes : ""}`);
  return {
    changes: res.changes.map(c => ({ ...c, title: state.tasks.find(t => t.id === c.task_id)?.title })),
    overflow: res.overflow, warnings: res.warnings, week_notes: res.week_notes, revision_id, dry_run: !!opts.dry,
  };
}

/** Auto "missed day" trigger: first authenticated request on a new IST day. Never throws. */
export function ensureMissedRun() {
  try {
    const today = todayIST();
    if (getSetting("last_missed_run") === today) return;
    setSetting("last_missed_run", today);
    runReschedule({ kind: "missed" }, { today, actor: "scheduler", reason: "missed: automatic run at first open of the day" });
  } catch (e) { console.error("auto missed-run failed:", e); }
}

// ---------------------------------------------------------------- attempts / mistakes
const LADDER = [1, 7, 21];
export function createAttempt(input: any, actor: Actor, trustedCorrect?: boolean) {
  const existing = input.id ? db.query("SELECT * FROM attempts WHERE id=?").get(input.id) as any : null;
  const q = db.query(trustedCorrect === undefined ? "SELECT * FROM questions WHERE id=? AND deleted_at IS NULL" : "SELECT * FROM questions WHERE id=?").get(input.question_id) as any;
  if (!q) throw new ApiError(422, "validation", `unknown question ${input.question_id}`);
  if (existing) {
    const m = db.query("SELECT * FROM mistakes WHERE attempt_id=?").get(existing.id) as any;
    return { attempt: existing, correct: !!existing.correct, correct_answer: q.answer, mistake: m ?? undefined, duplicate: true };
  }
  let correct = trustedCorrect ?? grade(q, input.given_answer);
  if (correct === null) {
    if (input.correct === undefined) throw new ApiError(422, "ungradable", "question has no answer key (needs_review); pass `correct` to self-grade");
    correct = !!input.correct;
  }
  const at = input.at ?? now();
  const id = input.id ?? uuid();
  let mistake: any;
  db.transaction(() => {
    db.run(`INSERT INTO attempts(id,question_id,at,given_answer,correct,time_s,error_type,used_hint,mode,mock_id,notes,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, q.id, at, input.given_answer == null ? null : String(input.given_answer), correct ? 1 : 0, input.time_s ?? null, input.error_type ?? null,
        input.used_hint ? 1 : 0, input.mode ?? "practice", input.mock_id ?? null, input.notes ?? null, now()]);
    const day = istDate(at);
    if (!correct) {
      const open = db.query("SELECT * FROM mistakes WHERE question_id=? AND status='open'").get(q.id) as any;
      const due = addDays(day, 1);
      if (open) {
        db.run("UPDATE mistakes SET stage=0, due_on=?, attempt_id=?, error_type=COALESCE(?,error_type), updated_at=? WHERE id=?", [due, id, input.error_type ?? null, now(), open.id]);
        mistake = db.query("SELECT * FROM mistakes WHERE id=?").get(open.id);
      } else {
        const mid = uuid();
        db.run("INSERT INTO mistakes(id,question_id,attempt_id,error_type,stage,due_on,status,created_at,updated_at) VALUES (?,?,?,?,0,?, 'open', ?, ?)",
          [mid, q.id, id, input.error_type ?? null, due, now(), now()]);
        mistake = db.query("SELECT * FROM mistakes WHERE id=?").get(mid);
      }
    }
    refreshTopicProgress(q.topic_id, day);
    recomputeAttemptMinutes(day);
  })();
  return { attempt: db.query("SELECT * FROM attempts WHERE id=?").get(id), correct, correct_answer: q.answer, mistake };
}

export function refreshTopicProgress(topicId: string, day: string) {
  const r = db.query(`WITH last AS (SELECT a.question_id, a.correct, ROW_NUMBER() OVER (PARTITION BY a.question_id ORDER BY a.at DESC) rn
      FROM attempts a JOIN questions q ON q.id=a.question_id WHERE q.topic_id=?)
    SELECT COUNT(*) n, COALESCE(SUM(correct),0) c FROM last WHERE rn=1`).get(topicId) as any;
  db.run(`INSERT INTO topic_progress(topic_id,status,questions_done,questions_correct,last_studied_on,updated_at) VALUES (?, 'todo', ?, ?, ?, ?)
    ON CONFLICT(topic_id) DO UPDATE SET questions_done=excluded.questions_done, questions_correct=excluded.questions_correct, last_studied_on=excluded.last_studied_on, updated_at=excluded.updated_at`,
    [topicId, r.n, r.c, day, now()]);
}

export function reviewMistake(id: string, correct: boolean, at?: string) {
  const m = db.query("SELECT * FROM mistakes WHERE id=?").get(id) as any;
  if (!m) throw notFound("mistake");
  if (m.status === "retired") throw new ApiError(409, "conflict", "mistake already retired");
  const day = istDate(at ?? now());
  let stage = 0, due = addDays(day, 1), status = "open";
  if (correct) {
    stage = m.stage + 1;
    if (stage >= 3) { status = "retired"; due = day; } else due = addDays(day, LADDER[stage]!);
  }
  db.run("UPDATE mistakes SET stage=?, due_on=?, status=?, last_reviewed_on=?, updated_at=? WHERE id=?", [stage, due, status, day, now(), id]);
  return db.query("SELECT * FROM mistakes WHERE id=?").get(id) as any;
}

// ---------------------------------------------------------------- cards
export function reviewCard(id: string, input: { grade?: number; time_ms?: number | null; mode?: string; correct?: boolean; at?: string; review_id?: string }) {
  const c = db.query("SELECT * FROM cards WHERE id=? AND deleted_at IS NULL").get(id) as any;
  if (!c) throw notFound("card");
  const mode = input.mode ?? "review";
  let g = input.grade;
  if (g === undefined) {
    if (input.correct === undefined) throw new ApiError(422, "validation", "grade (0-5) or correct is required");
    g = gameGrade(mode, !!input.correct, input.time_ms);
  }
  if (!Number.isInteger(g) || g < 0 || g > 5) throw new ApiError(422, "validation", "grade must be an integer 0..5");
  const at = input.at ?? now();
  const day = istDate(at);
  const rid = input.review_id ?? uuid();
  if (db.query("SELECT 1 FROM card_reviews WHERE id=?").get(rid)) return db.query("SELECT * FROM cards WHERE id=?").get(id) as any;
  const next = sm2(c, g);
  db.transaction(() => {
    db.run("INSERT INTO card_reviews(id,card_id,at,grade,time_ms,mode,updated_at) VALUES (?,?,?,?,?,?,?)", [rid, id, at, g, input.time_ms ?? null, mode, now()]);
    db.run("UPDATE cards SET ease=?, interval_d=?, reps=?, lapses=?, due_on=?, last_reviewed_on=?, updated_at=? WHERE id=?",
      [next.ease, next.interval_d, next.reps, next.lapses, addDays(day, next.due_in_days), day, now(), id]);
  })();
  return db.query("SELECT * FROM cards WHERE id=?").get(id) as any;
}
export function nextIntervals(c: any) {
  const o: Record<number, number> = {};
  for (const g of [0, 3, 4, 5]) o[g] = sm2(c, g).interval_d;
  return o;
}
export function newCardsLeftToday(today: string): number {
  const cap = Number(getSetting("new_cards_per_day", "10"));
  const used = (db.query(`SELECT COUNT(*) n FROM (SELECT card_id, MIN(at) f FROM card_reviews GROUP BY card_id) WHERE date(f,'+330 minutes')=?`).get(today) as any).n;
  return Math.max(0, cap - used);
}
export function dueCounts(today: string) {
  const dueReviews = (db.query("SELECT COUNT(*) n FROM cards WHERE deleted_at IS NULL AND due_on<=? AND last_reviewed_on IS NOT NULL").get(today) as any).n;
  const newAvail = (db.query("SELECT COUNT(*) n FROM cards WHERE deleted_at IS NULL AND due_on<=? AND last_reviewed_on IS NULL").get(today) as any).n;
  const cards = dueReviews + Math.min(newAvail, newCardsLeftToday(today));
  const mistakes = (db.query("SELECT COUNT(*) n FROM mistakes WHERE status='open' AND due_on<=?").get(today) as any).n;
  return { cards, mistakes };
}

// ---------------------------------------------------------------- streaks
export function computeStreaks(today = todayIST()) {
  const thr = Number(getSetting("streak_study_min", "60"));
  const studyDays = new Set((db.query("SELECT date FROM effective_study_minutes GROUP BY date HAVING SUM(minutes)>=?").all(thr) as any[]).map(r => r.date));
  const gymDays = new Set((db.query("SELECT date FROM checkins WHERE gym_done=1").all() as any[]).map(r => r.date));
  const jobDays = new Set((db.query("SELECT date FROM checkins WHERE job_applications>=1").all() as any[]).map(r => r.date));
  const revDays = new Set((db.query("SELECT date FROM checkins WHERE revision_done=1").all() as any[]).map(r => r.date));
  const counts = new Map<string, number>();
  for (const r of db.query("SELECT date(at,'+330 minutes') d, COUNT(*) n FROM card_reviews GROUP BY d").all() as any[]) counts.set(r.d, r.n);
  for (const r of db.query("SELECT last_reviewed_on d, COUNT(*) n FROM mistakes WHERE last_reviewed_on IS NOT NULL GROUP BY d").all() as any[]) counts.set(r.d, (counts.get(r.d) ?? 0) + r.n);
  for (const [d, n] of counts) if (n >= 5) revDays.add(d);
  const all = [...studyDays, ...gymDays, ...jobDays, ...revDays].sort();
  const earliest = all[0] ?? today;
  const from = diffDays(earliest, today) > 400 ? addDays(today, -400) : earliest;
  return {
    study: computeStreak(d => studyDays.has(d), from, today),
    gym: computeStreak(d => gymDays.has(d), from, today),
    revision: computeStreak(d => revDays.has(d), from, today),
    job: computeStreak(d => jobDays.has(d), from, today, { weekdaysOnly: true }),
  };
}
export { hydrate, STUDY_TYPES };
