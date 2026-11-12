import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "gate-test-"));
process.env.API_TOKEN = "tok";
process.env.SESSION_SECRET = "s";
process.env.APP_PASSWORD_HASH = await Bun.password.hash("pw", { algorithm: "argon2id" });

const { buildApp } = await import("../app");
const { runSeed } = await import("../../seed/load");
const { db } = await import("../db");
const { addDays, istDate } = await import("../util");
const app = buildApp();

const call = (method: string, path: string, body?: any, headers: Record<string, string> = { Authorization: "Bearer tok" }) =>
  app.fetch(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
const j = async (method: string, path: string, body?: any, headers?: Record<string, string>) => { const r = await call(method, path, body, headers); return { status: r.status, body: r.status === 204 ? null : await r.json() as any }; };

beforeAll(() => { runSeed(); });

describe("search", () => {
  test("groups case-insensitive matches without answers and requires auth", async () => {
    expect((await call("GET", "/api/search?q=needle", undefined, {})).status).toBe(401);
    expect((await j("GET", "/api/search?q=n")).body).toEqual({ chapters: [], concepts: [], questions: [] });
    const topic = "search.needle";
    const parent = db.query("SELECT subject_id, scope FROM topics WHERE id='prob.bayes'").get() as any;
    db.run("INSERT INTO topics(id,subject_id,name,scope,updated_at) VALUES (?,?,?,?,?)", [topic, parent.subject_id, "Needle chapter", parent.scope, new Date().toISOString()]);
    db.run("INSERT INTO topic_notes(topic_id,atoms,updated_at) VALUES (?,?,?) ON CONFLICT(topic_id) DO UPDATE SET atoms=excluded.atoms", [topic, JSON.stringify([{ id: "needle-atom", name: "Needle concept", one_line: "Needle detail" }]), new Date().toISOString()]);
    db.run("INSERT INTO topic_explainers(topic_id,title,data,updated_at) VALUES (?,?,?,?)", [topic, "Needle guide", JSON.stringify({ cards: [{ atom_id: "needle-atom", title: "Needle card", simple: "Find violetwidget here" }] }), new Date().toISOString()]);
    await j("POST", "/api/questions", { id: "search.needle", source: "generated", topic_id: topic, type: "MCQ", stem: "Needle question", options: [{ key: "A", text: "x" }], answer: "A" });
    const r = await j("GET", "/api/search?q=NEEDLE&limit=1");
    expect(r.status).toBe(200);
    expect(r.body.chapters).toHaveLength(1); expect(r.body.concepts).toHaveLength(1); expect(r.body.questions).toHaveLength(1);
    expect(r.body.questions[0]).toMatchObject({ id: "search.needle", snippet: "Needle question" });
    expect(JSON.stringify(r.body)).not.toContain('"answer"');
    expect((await j("GET", "/api/search?q=VIOLETWIDGET")).body.concepts[0].snippet).toContain("violetwidget");
  });
});

test("Today counts distinct answered questions on the IST day and validates its goal", async () => {
  const q = (db.query("SELECT id FROM questions LIMIT 1").get() as any).id;
  const q2 = (db.query("SELECT id FROM questions WHERE id<>? LIMIT 1").get(q) as any).id;
  for (const [id, question, at, answer, mode] of [
    ["goal.1", q, "2029-01-01T18:29:00Z", "A", "practice"],
    ["goal.2", q, "2029-01-01T18:30:00Z", "A", "test"],
    ["goal.3", q, "2029-01-02T01:00:00Z", "A", "mock"],
    ["goal.4", q2, "2029-01-02T02:00:00Z", "A", "revision"],
    ["goal.5", q2, "2029-01-02T03:00:00Z", "", "practice"],
  ]) db.run("INSERT INTO attempts(id,question_id,at,given_answer,correct,mode,updated_at) VALUES (?,?,?,?,0,?,?)", [id, question, at, answer, mode, at]);
  expect((await j("GET", "/api/plan/today?date=2029-01-01")).body.questions_done).toBe(1);
  expect((await j("GET", "/api/plan/today?date=2029-01-02")).body).toMatchObject({ questions_done: 2, daily_question_goal: 30 });
  expect((await j("GET", "/api/settings")).body.daily_question_goal).toBe("30");
  expect((await j("PATCH", "/api/settings", { daily_question_goal: 201 })).status).toBe(422);
  expect((await j("PATCH", "/api/settings", { daily_question_goal: -1 })).status).toBe(422);
  expect((await j("PATCH", "/api/settings", { daily_question_goal: 0 })).status).toBe(200);
  expect((await j("GET", "/api/plan/today?date=2029-01-02")).body.daily_question_goal).toBe(0);
});

describe("auth", () => {
  test("healthz is public, api needs auth", async () => {
    expect((await call("GET", "/healthz", undefined, {})).status).toBe(200);
    expect((await call("GET", "/api/me", undefined, {})).status).toBe(401);
    expect((await call("GET", "/api/me", undefined, { Authorization: "Bearer wrong" })).status).toBe(401);
    expect((await j("GET", "/api/me")).body.actor).toBe("claude");
  });
  test("login sets HttpOnly cookie, cookie writes need X-Requested-With, bad password 401, rate limit 429", async () => {
    const bad = await call("POST", "/api/auth/login", { password: "nope" }, {});
    expect(bad.status).toBe(401);
    const ok = await call("POST", "/api/auth/login", { password: "pw" }, {});
    expect(ok.status).toBe(204);
    const sc = ok.headers.get("set-cookie")!;
    expect(sc).toContain("HttpOnly"); expect(sc).toContain("SameSite=Lax");
    const cookie = sc.split(";")[0]!;
    expect((await j("GET", "/api/me", undefined, { cookie })).body.actor).toBe("user");
    expect((await call("POST", "/api/auth/logout", undefined, {})).status).toBe(401);
    expect((await j("PATCH", "/api/settings", { x: "1" }, { cookie })).status).toBe(403);
    expect((await j("PATCH", "/api/settings", { x_test: "1" }, { cookie, "x-requested-with": "app" })).status).toBe(200);
    for (let i = 0; i < 4; i++) await call("POST", "/api/auth/login", { password: "nope" }, {});
    expect((await call("POST", "/api/auth/login", { password: "pw" }, {})).status).toBe(429);
    await call("POST", "/api/auth/logout", undefined, { cookie, "x-requested-with": "app" });
    expect((await j("GET", "/api/me", undefined, { cookie })).status).toBe(401);
  });
});

describe("questions, attempts, mistakes", () => {
  let qid = "";
  test("filters + ordering + created_by=claude", async () => {
    const mk = (n: number, d: number) => ({ topic_id: "prob.bayes", type: "MCQ", stem: `gen ${n}`, answer: "B", options: [{ key: "A", text: "x" }, { key: "B", text: "y" }], difficulty: d, source: "generated", order_in_topic: n });
    const r = await j("POST", "/api/questions", { questions: [mk(1, 4), mk(2, 1), mk(3, 2)] });
    expect(r.status).toBe(201); expect(r.body.created).toBe(3);
    const l = await j("GET", "/api/questions?topic=prob.bayes&source=generated&order=difficulty");
    expect(l.body.items.map((q: any) => q.difficulty)).toEqual([1, 2, 4]);
    expect(l.body.items[0].created_by).toBe("claude");
    expect((await j("GET", "/api/questions?topic_id=prob&difficulty_min=2&difficulty_max=4")).body.items.length).toBe(2); // parent topic includes descendants
    expect((await j("GET", "/api/questions?paper=CS&year=2024&source=official&limit=500")).body.items.length).toBe(130);
    qid = l.body.items[0].id;
  });
  test("official upsert by natural key", async () => {
    const q = { source: "official", paper: "CS", year: 2024, session: "CS1", q_no: "1", topic_id: "ga", type: "MCQ", stem: "updated", answer: "A" };
    const r = await j("POST", "/api/questions", { questions: [q] });
    expect(r.body.updated).toBe(1);
    expect((await j("GET", "/api/questions/2024-CS1-q1")).body.stem).toBe("updated");
  });
  test("wrong answer creates mistake (1d), correct review climbs 1d->1w->3w->retired, wrong resets", async () => {
    const a = await j("POST", "/api/attempts", { question_id: qid, given_answer: "A", time_s: 30, at: "2026-11-01T06:00:00Z" });
    expect(a.body.correct).toBe(false);
    const m = a.body.mistake;
    expect(m.due_on).toBe("2026-11-02"); expect(m.stage).toBe(0);
    // one open row per question
    const a2 = await j("POST", "/api/attempts", { question_id: qid, given_answer: "A", at: "2026-11-01T07:00:00Z" });
    expect(a2.body.mistake.id).toBe(m.id);
    expect((await j("GET", "/api/mistakes?due=all")).body.items.filter((x: any) => x.question_id === qid).length).toBe(1);
    const at = (d: string) => ({ correct: true, at: d + "T06:00:00Z" });
    let r = await j("POST", `/api/mistakes/${m.id}/review`, at("2026-11-02"));
    expect([r.body.stage, r.body.due_on]).toEqual([1, "2026-11-09"]);
    r = await j("POST", `/api/mistakes/${m.id}/review`, at("2026-11-09"));
    expect([r.body.stage, r.body.due_on]).toEqual([2, "2026-11-30"]);
    r = await j("POST", `/api/mistakes/${m.id}/review`, { correct: false, at: "2026-11-30T06:00:00Z" });
    expect([r.body.stage, r.body.due_on]).toEqual([0, "2026-12-01"]);
    for (const d of ["2026-12-01", "2026-12-08", "2026-12-29"]) r = await j("POST", `/api/mistakes/${m.id}/review`, at(d));
    expect([r.body.stage, r.body.status]).toEqual([3, "retired"]);
  });
  test("idempotent attempt id, grading of MSQ/NAT, error_type patch, topic progress cache", async () => {
    await j("POST", "/api/questions", { id: "nat1", topic_id: "prob.bayes", type: "NAT", stem: "n", answer: "12.4..12.6", source: "custom" });
    const a = await j("POST", "/api/attempts", { id: "att-1", question_id: "nat1", given_answer: "12.5", time_s: 10 });
    expect(a.body.correct).toBe(true);
    const dup = await j("POST", "/api/attempts", { id: "att-1", question_id: "nat1", given_answer: "99" });
    expect(dup.status).toBe(200); expect(dup.body.correct).toBe(true);
    expect((await j("GET", "/api/attempts?question_id=nat1")).body.items.length).toBe(1);
    const w = await j("POST", "/api/attempts", { id: "att-2", question_id: "nat1", given_answer: "13" });
    expect(w.body.correct).toBe(false);
    expect((await j("PATCH", "/api/attempts/att-2", { error_type: "calculation" })).body.error_type).toBe("calculation");
    expect((await j("GET", "/api/mistakes")).body.items.find((m: any) => m.question_id === "nat1").error_type).toBe("calculation");
    const t = (await j("GET", "/api/topics?subject=prob")).body.items.find((x: any) => x.id === "prob.bayes");
    expect(t.progress.questions_done).toBeGreaterThan(0);
    expect(t.question_count).toBeGreaterThan(0);
  });
  test("validation errors use the error envelope", async () => {
    const r = await j("POST", "/api/attempts", { question_id: "nope", given_answer: "A" });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe("validation");
    expect((await j("POST", "/api/questions", { type: "MCQ" })).status).toBe(422);
  });
});

describe("cards", () => {
  test("SM-2 review, due list with new-card cap, games", async () => {
    const r = await j("POST", "/api/cards", { cards: Array.from({ length: 12 }, (_, i) => ({ topic_id: "prob.bayes", kind: "pair", front: `f${i}`, back: `b${i}` })) });
    expect(r.status).toBe(201);
    const due = await j("GET", "/api/cards/due?limit=30");
    expect(due.body.items.length).toBe(10); // new cards capped at 10/day
    const c = due.body.items[0];
    expect(c.created_by).toBe("claude");
    const rev = await j("POST", `/api/cards/${c.id}/review`, { grade: 4 });
    expect([rev.body.reps, rev.body.interval_d]).toEqual([1, 1]);
    const rev2 = await j("POST", `/api/cards/${c.id}/review`, { grade: 2 });
    expect([rev2.body.reps, rev2.body.lapses]).toEqual([0, 1]);
    const g = await j("POST", `/api/cards/${due.body.items[1].id}/review`, { mode: "match", correct: false });
    expect(g.body.lapses).toBe(1);
    const pairs = await j("GET", "/api/games/pairs?topic_id=prob&n=6");
    expect(pairs.body.round.length).toBe(6);
  });
});

describe("plan", () => {
  test("today, task complete feeds study_minutes + streak, tasks created by claude", async () => {
    const day = "2026-11-03";
    const today = await j("GET", `/api/plan/today?date=${day}`);
    const t = today.body.tasks.find((x: any) => x.type === "study");
    const done = await j("POST", `/api/plan/tasks/${t.id}/complete`, { done_minutes: 75 });
    expect(done.body.status).toBe("done");
    const sm = db.query("SELECT SUM(minutes) m FROM study_minutes WHERE date=? AND source='task'").get(day) as any;
    expect(sm.m).toBe(75);
    const nt = await j("POST", "/api/plan/tasks", { date: day, title: "extra", type: "study", est_minutes: 20 });
    expect(nt.body.created_by).toBe("claude"); expect(nt.status).toBe(201);
    expect((await j("POST", "/api/plan/tasks", { date: "2030-01-01", title: "x", type: "study" })).status).toBe(422);
  });
  test("missed-day reschedule: apply, idempotent, audit row, undo", async () => {
    const today = "2026-11-04";
    const dry = await j("POST", "/api/plan/reschedule", { trigger: "missed", today, dry_run: true });
    expect(dry.body.changes.length).toBeGreaterThan(0); expect(dry.body.revision_id).toBeNull();
    const before = (db.query("SELECT COUNT(*) n FROM plan_tasks WHERE deleted_at IS NULL").get() as any).n;
    const r1 = await j("POST", "/api/plan/reschedule", { trigger: "missed", today });
    expect(r1.body.revision_id).toBeTruthy();
    const mid = (db.query("SELECT COUNT(*) n FROM plan_tasks WHERE deleted_at IS NULL").get() as any).n;
    expect(mid).toBeGreaterThan(before);
    const r2 = await j("POST", "/api/plan/reschedule", { trigger: "missed", today });
    expect(r2.body.changes).toEqual([]);
    expect((await j("GET", "/api/plan/revisions")).body.items[0].actor).toBe("claude");
    // no day above 115% in the current week
    const week = (await j("GET", `/api/plan?from=${today}&to=2026-11-08`)).body.days;
    for (const d of week) expect(d.planned_minutes).toBeLessThanOrEqual(Math.floor(d.capacity_minutes * 1.15) + 1);
    const u = await j("POST", `/api/plan/revisions/${r1.body.revision_id}/undo`);
    expect(u.body.removed).toBeGreaterThan(0);
    expect((db.query("SELECT COUNT(*) n FROM plan_tasks WHERE deleted_at IS NULL").get() as any).n).toBe(before);
    expect((await j("POST", `/api/plan/revisions/${r1.body.revision_id}/undo`)).status).toBe(409);
  });
  test("capacity scale-down via PATCH day, replace, weeks", async () => {
    const day = "2026-11-10";
    const r = await j("PATCH", `/api/plan/days/${day}`, { available_minutes: 200 });
    expect(r.body.available_minutes).toBe(200);
    expect(r.body.reschedule.changes.length).toBeGreaterThan(0);
    const d = await j("GET", `/api/plan/days/${day}`);
    expect(d.body.planned_minutes).toBeLessThanOrEqual(200);
    const rep = await j("POST", "/api/plan/replace", { from: "2026-11-16", to: "2026-11-17", reason: "test", tasks: [{ date: "2026-11-16", title: "only", type: "study", est_minutes: 60 }] });
    expect(rep.body.counts.added).toBe(1); expect(rep.body.counts.removed).toBeGreaterThan(0);
    expect((await j("GET", "/api/plan/days/2026-11-16")).body.tasks.filter((t: any) => t.status === "todo").length).toBe(1);
    const w = await j("PATCH", "/api/plan/weeks/w4", { macro_goals: [{ text: "g", done: true }] });
    expect(w.body.macro_goals[0].id).toBeTruthy();
    expect((await j("PUT", "/api/plan/weeks", { weeks: [{ start_date: "2026-10-26", title: "New title" }] })).body.updated).toBe(1);
  });
});

describe("sync", () => {
  test("pull returns changed rows; push is idempotent and rejects stale", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    await j("PATCH", "/api/settings", { zzz: "1" });
    const pull = await j("GET", `/api/sync/pull?since=${since}&tables=settings,questions`);
    expect(pull.body.tables.settings.some((s: any) => s.key === "zzz")).toBe(true);
    const q = await j("POST", "/api/questions", { topic_id: "ga", type: "MCQ", stem: "sync q", answer: "A", options: [{ key: "A", text: "a" }] });
    const ops = [
      { id: "op1", table: "attempts", op: "upsert", client_ts: new Date().toISOString(), data: { id: "sa1", question_id: q.body.id, given_answer: "A", time_s: 5 } },
      { id: "op2", table: "checkins", op: "upsert", client_ts: new Date().toISOString(), data: { date: "2026-11-05", mood: 3 } },
      { id: "op3", table: "card_reviews", op: "upsert", client_ts: new Date().toISOString(), data: { card_id: "missing", grade: 4 } },
      { id: "op4", table: "plan_tasks", op: "upsert", client_ts: "2000-01-01T00:00:00Z", data: { id: "seed-2026-11-05-02", title: "old" } },
    ];
    const r1 = await j("POST", "/api/sync/push", { ops });
    expect(r1.body.applied).toEqual(["op1", "op2"]);
    expect(r1.body.rejected.map((x: any) => x.id).sort()).toEqual(["op3", "op4"]);
    const r2 = await j("POST", "/api/sync/push", { ops });
    expect(r2.body.applied).toEqual(["op1", "op2"]);
    expect((await j("GET", "/api/attempts?question_id=" + q.body.id)).body.items.length).toBe(1);
  });
  test("plan_tasks: done beats everything", async () => {
    const id = "seed-2026-11-06-02";
    await j("POST", `/api/plan/tasks/${id}/complete`);
    const r = await j("POST", "/api/sync/push", { ops: [{ id: "op9", table: "plan_tasks", op: "upsert", client_ts: new Date(Date.now() + 5000).toISOString(), data: { id, status: "todo" } }] });
    expect(r.body.applied).toEqual(["op9"]);
    expect((await j("GET", `/api/plan/tasks/${id}`)).body.status).toBe("done");
  });
  test("a transient sync bookkeeping failure rolls back the write and permits retry", async () => {
    const question = (db.query("SELECT id FROM questions LIMIT 1").get() as any).id;
    const op = { id: "sync-transient", table: "attempts", op: "upsert", data: { id: "sync-transient-attempt", question_id: question, given_answer: "A" } };
    db.run("CREATE TRIGGER block_sync BEFORE INSERT ON sync_ops BEGIN SELECT RAISE(ABORT,'temporary failure'); END");
    try {
      expect((await j("POST", "/api/sync/push", { ops: [op] })).body.rejected).toHaveLength(1);
      expect(db.query("SELECT 1 FROM attempts WHERE id='sync-transient-attempt'").get()).toBeNull();
      expect(db.query("SELECT 1 FROM sync_ops WHERE id='sync-transient'").get()).toBeNull();
    } finally { db.run("DROP TRIGGER block_sync"); }
    expect((await j("POST", "/api/sync/push", { ops: [op] })).body.applied).toEqual(["sync-transient"]);
  });
});

describe("import/export/backup", () => {
  test("export -> import(replace_tables) round trips; dry-run changes nothing; auto-backup", async () => {
    const exp = (await j("GET", "/api/export")).body;
    expect(exp.questions.length).toBeGreaterThan(1225);
    const dry = await j("POST", "/api/import", { mode: "replace_tables", dry_run: true, data: exp });
    expect(dry.status).toBe(200); expect(dry.body.errors).toEqual([]); expect(dry.body.applied).toBe(false);
    const nQ = (db.query("SELECT COUNT(*) n FROM questions").get() as any).n;
    const real = await j("POST", "/api/import", { mode: "replace_tables", data: exp });
    expect(real.status).toBe(200); expect(real.body.applied).toBe(true); expect(real.body.backup).toContain("pre-import");
    expect((db.query("SELECT COUNT(*) n FROM questions").get() as any).n).toBe(nQ);
    const exp2 = (await j("GET", "/api/export")).body;
    for (const k of ["questions", "plan_tasks", "attempts", "mistakes", "cards", "checkins", "plan_revisions"]) expect(exp2[k].length).toBe(exp[k].length);
  });
  test("merge upserts by natural key and is atomic on errors", async () => {
    const r = await j("POST", "/api/import", { data: { videos: [{ url: "https://example.com/v", topic_id: "prob", title: "A" }], jobs: [{ company: "Acme", role: "SDE" }] } });
    expect(r.body.counts.created).toBe(2);
    const r2 = await j("POST", "/api/import", { data: { videos: [{ url: "https://example.com/v", topic_id: "prob", title: "A" }, { url: "https://example.com/v", topic_id: "prob", title: "B" }], jobs: [{ company: "Acme", role: "SDE" }] } });
    expect(r2.body.counts).toEqual({ created: 0, updated: 1, skipped: 2 });
    const bad = await j("POST", "/api/import", { data: { jobs: [{ company: "Okay" }], questions: [{ id: "bad", topic_id: "nonexistent", type: "MCQ", stem: "s", answer: "A", source: "custom" }] } });
    expect(bad.status).toBe(422); expect(bad.body.errors.length).toBeGreaterThan(0);
    expect((db.query("SELECT COUNT(*) n FROM jobs WHERE company='Okay'").get() as any).n).toBe(0);
  });
  test("csv import for jobs and mocks", async () => {
    const res = await app.fetch(new Request("http://x/api/import?table=mocks", { method: "POST", headers: { Authorization: "Bearer tok", "content-type": "text/csv" },
      body: "date,paper,year,session,raw_score,attempted_marks,accuracy_percent,time_issue,three_topics_to_revise,notes\n2026-10-10,CS,2025,CS1,40.5,60,70,rushed,\"os;dbms\",\"first, diagnostic\"\n" }));
    const b = await res.json() as any;
    expect(b.counts.created).toBe(1);
    const m = (await j("GET", "/api/mocks?from=2026-10-10&to=2026-10-10")).body.items.find((x: any) => x.notes === "first, diagnostic");
    expect(m.topics_to_revise).toEqual(["os", "dbms"]); expect(m.notes).toBe("first, diagnostic");
  });
  test("manual backup", async () => {
    const r = await j("POST", "/api/admin/backup");
    expect(r.status).toBe(201); expect(r.body.bytes).toBeGreaterThan(1000);
    const latest = await call("GET", "/api/admin/backup/latest");
    expect(latest.status).toBe(200);
  });
});

describe("misc", () => {
  test("stats, streaks, log, settings, idempotency-key", async () => {
    const s = await j("GET", "/api/stats/overview?from=2026-10-01&to=2026-12-01");
    expect(s.status).toBe(200);
    for (const k of ["study_minutes_by_subject", "accuracy_by_topic", "mock_trend", "plan_adherence", "weak_topics", "days_to_exam", "syllabus_coverage"]) expect(s.body[k]).toBeDefined();
    expect((await j("GET", "/api/streaks")).body.study).toBeDefined();
    expect((await j("GET", "/api/log?from=2026-11-01&to=2026-11-03")).body.days.length).toBe(3);
    const h = { Authorization: "Bearer tok", "Idempotency-Key": "k1" };
    const a = await j("POST", "/api/jobs", { company: "Idem" }, h);
    const b = await j("POST", "/api/jobs", { company: "Idem" }, h);
    expect(b.body.id).toBe(a.body.id);
    expect((await j("GET", "/api/nothing")).status).toBe(404);
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });
});

describe("module switches", () => {
  test("disabled jobs route returns 404 while practice remains available", async () => {
    const before = await j("GET", "/api/modules");
    expect(before.body.items.find((x: any) => x.id === "jobs").enabled).toBe(true);
    expect((await j("PATCH", "/api/modules/jobs", { enabled: false })).status).toBe(200);
    expect((await j("GET", "/api/jobs")).status).toBe(404);
    expect((await j("GET", "/api/questions?limit=1")).status).toBe(200);
    await j("PATCH", "/api/modules/jobs", { enabled: true });
  });
});

describe("import-content", () => {
  test("tags applied, idempotent, never overwrites official answers", async () => {
    const { runImportContent } = await import("../../seed/import_content");
    const before = (db.query("SELECT answer FROM questions WHERE id='2024-CS1-q1'").get() as any).answer;
    const a = runImportContent();
    expect(a.counts.tagged).toBe(1225);
    expect((db.query("SELECT COUNT(*) n FROM questions WHERE topic_id='general.unsorted'").get() as any).n).toBe(0);
    const snap = () => JSON.stringify(db.query("SELECT id, topic_id, difficulty, hints, answer, in_2027_syllabus FROM questions ORDER BY id").all());
    const s1 = snap(), cards = (db.query("SELECT COUNT(*) n FROM cards").get() as any).n;
    runImportContent();
    expect(snap()).toBe(s1);
    expect((db.query("SELECT COUNT(*) n FROM cards").get() as any).n).toBe(cards);
    expect((db.query("SELECT answer FROM questions WHERE id='2024-CS1-q1'").get() as any).answer).toBe(before);
    expect((await j("GET", "/api/questions?in_syllabus=0&limit=500")).body.items.length).toBeGreaterThan(0);
    expect((await j("GET", "/api/topics/prob.bayes/blueprint")).status).toBe(200);
    expect((await j("POST", "/api/import/content")).status).toBe(200);
  });
});

describe("analytics and inbox", () => {
  test("mastery maths and marks-per-hour ranking", async () => {
    const { masteryScore, rankPriority } = await import("../modules/practice/analytics");
    const time = new Date("2026-10-07T00:00:00Z");
    expect(masteryScore([{ correct: 1, difficulty: 1, at: time.toISOString() }, { correct: 0, difficulty: 5, at: time.toISOString() }], time)).toBe(30);
    expect(masteryScore([{ correct: 1, used_hint: 1, difficulty: 3, at: time.toISOString() }], time)).toBe(50);
    expect(masteryScore([{ correct: 1, difficulty: 3, at: "2026-09-23T00:00:00Z" }, { correct: 0, difficulty: 3, at: time.toISOString() }], time)).toBe(33);
    const ranked = rankPriority([{ topic_id: "a", subject_weight: 10, accuracy: 0.5, hours_remaining: 2 }, { topic_id: "b", subject_weight: 8, accuracy: 0, hours_remaining: 1 }]);
    expect(ranked.map(x => x.topic_id)).toEqual(["b", "a"]); expect(ranked[0]?.expected_gain).toBe(8);
    const { cutoffPoints } = await import("../modules/habits/analytics");
    expect(cutoffPoints({ CS: { "2024": { general: 25 } } })[0]?.score).toBe(25);
  });
  test("doubts, reports CRUD and compact digest", async () => {
    const doubt = await j("POST", "/api/doubts", { ref_type: "chapter", ref_id: "prob.bayes", note: "Why this step?" });
    expect(doubt.status).toBe(201); expect(doubt.body.created_by).toBe("claude");
    expect((await j("GET", "/api/doubts")).body.items.some((x: any) => x.id === doubt.body.id)).toBe(true);
    const answered = await j("PATCH", `/api/doubts/${doubt.body.id}`, { answer_md: "Use $P(A|B)$.", read: true });
    expect(answered.body.status).toBe("answered"); expect(answered.body.read_at).toBeTruthy();
    const day = istDate();
    const report = await j("POST", "/api/reports", { kind: "daily", period_start: day, period_end: day, title: "Day review", body_md: "**Done**" });
    expect(report.status).toBe(201); expect((await j("GET", "/api/reports")).body.unread).toBeGreaterThan(0);
    expect((await j("PATCH", `/api/reports/${report.body.id}`, { read: true })).body.read_at).toBeTruthy();
    const digest = await j("GET", `/api/digest?from=${day}&to=${day}`);
    expect(digest.status).toBe(200); expect(digest.body.from).toBe(day);
    expect(digest.body.doubts.some((x: any) => x.id === doubt.body.id)).toBe(true);
    expect(digest.body.reports.some((x: any) => x.id === report.body.id)).toBe(true);
    expect((await j("GET", "/api/digest?from=2026-10-08&to=2026-10-07")).status).toBe(422);
  });
});

describe("analytics endpoints", () => {
  test("mastery, priority, period, energy, scores, drills, push and strategy respond", async () => {
    for (const path of ["/api/mastery", "/api/priority?paper=CS", "/api/analytics/period?period=weekly", "/api/analytics/energy", "/api/analytics/scores", "/api/drills/questions?duration_s=60", "/api/push/vapid"]) {
      const r = await j("GET", path); expect(r.status).toBe(200);
    }
    const id = (db.query("SELECT id FROM test_sessions WHERE submitted_at IS NOT NULL LIMIT 1").get() as any)?.id;
    if (id) expect((await j("GET", `/api/strategy/${id}`)).status).toBe(200);
    expect((await j("POST", "/api/drills/results", { duration_s: 60, answers: [] })).status).toBe(200);
  });
});


describe("curated videos", () => {
  test("imports timestamps, skips underscore files, and reimports without duplicates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-videos-"));
    mkdirSync(join(dir, "videos"));
    writeFileSync(join(dir, "videos", "_sample.json"), "invalid json intentionally skipped");
    writeFileSync(join(dir, "videos", "prob.bayes.json"), JSON.stringify({ topic_id: "prob.bayes", videos: [{ id: "test-bayes-video", title: "Bayes", url: "https://www.youtube.com/watch?v=abcdefghijk", channel: "Example", lang: "hi", published: "2025-01-01", duration_s: 600, level: "gate", why: "Clear example", concepts: [{ atom_id: "bayes-rule", start_s: 42, note: "Worked example" }] }] }));
    const { runImportContent } = await import("../../seed/import_content");
    const first = runImportContent(join(dir, "videos"));
    expect(first.files.videos).toBe(1); expect(first.counts.videos).toBe(1);
    runImportContent(join(dir, "videos"));
    expect((db.query("SELECT COUNT(*) n FROM videos WHERE id='test-bayes-video'").get() as any).n).toBe(1);
    const v = await j("GET", "/api/videos/for-concept?topic_id=prob.bayes&atom_id=bayes-rule");
    expect(v.body.video.start_s).toBe(42); expect(v.body.video.lang).toBe("hi"); expect(v.body.video.level).toBe(2);
    const q = await j("POST", "/api/questions", { id: "test-video-q", topic_id: "prob.bayes", type: "NAT", source: "generated", stem: "Compute", answer: "1", atoms: ["bayes-rule"] });
    expect(q.status).toBe(201);
    expect((await j("GET", "/api/videos/for-question/test-video-q")).body.video.start_s).toBe(42);
    const saved = await j('PUT', '/api/videos/progress', { video_id: 'test-bayes-video', position_s: 121, completed: true });
    expect(saved.status).toBe(200); expect(saved.body.completed).toBe(1);
    expect((await j('PUT', '/api/videos/progress', { video_id: 'test-bayes-video', position_s: 150 })).body.completed).toBe(1);
    expect((await j('GET', '/api/videos/progress')).body.items.some((p: any) => p.video_id === 'test-bayes-video' && p.position_s === 150)).toBe(true);
    expect((await j('PUT', '/api/videos/progress', { video_id: 'missing', position_s: 1, completed: false })).status).toBe(404);
    db.run("INSERT INTO video_concepts(video_id,topic_id,atom_id,start_s) VALUES ('test-bayes-video','prob.bayes','b1',42)");
    for (const [id, published, start] of [['video-recent', '2027-01-01', 0], ['video-timestamped', '2026-01-01', 15]] as const) {
      db.run('INSERT INTO videos(id,topic_id,title,url,updated_at,published,level) VALUES (?,?,?,?,?,?,?)', [id, 'prob.bayes', id, 'https://www.youtube.com/watch?v=abcdefghijk', '2026-01-01T00:00:00Z', published, 1]);
      db.run('INSERT INTO video_concepts(video_id,topic_id,atom_id,start_s) VALUES (?,?,?,?)', [id, 'prob.bayes', 'b1', start]);
    }
    expect((await j('GET', '/api/videos/concept?topic_id=prob.bayes&atom_id=b1')).body.items.map((v: any) => v.id)).toEqual(['video-timestamped', 'test-bayes-video', 'video-recent']);
    const chapter = (await j('GET', '/api/videos/chapter?topic_id=prob.bayes')).body;
    expect(chapter.concepts.find((c: any) => c.atom_id === 'b1').video.id).toBe('video-timestamped');
    const course = (await j('GET', '/api/videos/course?subject_id=prob')).body;
    expect(course.chapters.some((c: any) => c.id === 'prob.bayes')).toBe(true);
  });
});

describe('foundations', () => {
  test('seed/import are additive, prerequisites and readiness grade by prerequisite', async () => {
    const { seedMissingTopics, seedFoundationPlan } = await import('../../seed/load');
    const { runImportContent } = await import('../../seed/import_content');
    const { db } = await import('../db');
    expect(seedMissingTopics()).toBe(0);
    expect(seedFoundationPlan()).toBe(0);
    expect((db.query("SELECT COUNT(*) n FROM plan_tasks WHERE id LIKE 'found-daily-%'").get() as any).n).toBeGreaterThan(0);
    expect((await j('GET', '/api/topics?scope=foundation')).body.items).toHaveLength(15);
    expect((await j('GET', '/api/topics?scope=cs')).body.items.some((x: any) => x.id === 'found')).toBe(false);
    runImportContent();
    const card = db.query("SELECT id FROM cards WHERE created_by='claude' LIMIT 1").get() as any;
    db.run("UPDATE cards SET back='My answer',created_by='user' WHERE id=?", [card.id]);
    const generated = db.query("SELECT id FROM questions WHERE source='generated' AND created_by='claude' LIMIT 1").get() as any;
    db.run("UPDATE questions SET stem='My question',created_by='user' WHERE id=?", [generated.id]);
    expect(runImportContent().counts.prereqs ?? 0).toBe(0);
    expect((db.query("SELECT back FROM cards WHERE id=?").get(card.id) as any).back).toBe('My answer');
    expect((db.query("SELECT stem FROM questions WHERE id=?").get(generated.id) as any).stem).toBe('My question');
    const p = await j('GET', '/api/topics/calc.limits/prereqs');
    expect(p.body.foundations.map((x: any) => x.id)).toEqual(['found.algebra','found.functions','found.explog','found.trig','found.limits_intuition']);
    expect(p.body.foundations[0].ready).toBe(false);
    await j('PUT', '/api/topics/found.algebra/progress', { status: 'mastered' });
    expect((await j('GET', '/api/topics/calc.limits/prereqs')).body.foundations[0].ready).toBe(true);
    db.run("UPDATE topics SET name='My algebra' WHERE id='found.algebra'");
    expect(seedMissingTopics()).toBe(0);
    expect((db.query("SELECT name FROM topics WHERE id='found.algebra'").get() as any).name).toBe('My algebra');
    const check = await j('GET', '/api/readiness/calc.limits');
    expect(check.body.questions).toHaveLength(5);
    expect(JSON.stringify(check.body.questions)).not.toContain('"answer"');
    expect((await j('GET', '/api/readiness/la.eigen')).body.available).toBe(true);
    expect((await j('GET', '/api/readiness/ga.verbal')).body.available).toBe(false);
    expect((await j('POST', '/api/readiness/calc.limits/submit', { answers: { unknown: 'A' } })).status).toBe(422);
    const result = await j('POST', '/api/readiness/calc.limits/submit', { answers: { 'algebra-factor': 'A', 'function-value': '5', 'log-inverse': '3', 'trig-zero': '1', approach: '5' } });
    expect(result.body.correct).toBe(4);
    expect(result.body.prerequisites.find((x: any) => x.id === 'found.trig').ready).toBe(false);
    expect((await j('GET', '/api/readiness/calc.limits')).body.latest.correct).toBe(4);
  });
});
