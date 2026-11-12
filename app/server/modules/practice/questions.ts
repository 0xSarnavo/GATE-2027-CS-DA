import { Hono } from "hono";
import { db } from "../../db";
import type { Env } from "../../auth";
import { config } from "../../config";
import { ApiError, notFound } from "../../errors";
import { parse, readJson, insertSql, updateSql, type Schema } from "../../validate";
import { dehydrate, hydrate, now, page, paging, uuid, isDate, todayIST, istDate } from "../../util";
import { createAttempt, createdBy, reviewMistake } from "../../lib/services";
import { sweepAutoTasks } from '../planner/auto';
import { mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";

const QTYPES = ["MCQ", "MSQ", "NAT"] as const;
const QUESTION: Schema = {
  source: { t: "str", enum: ["official", "generated", "book", "custom"] }, paper: { t: "str", enum: ["CS", "DA", "GA"], nullable: true },
  year: { t: "int", nullable: true }, session: { t: "str", nullable: true }, q_no: { t: "str", nullable: true },
  topic_id: { t: "str", req: true }, type: { t: "str", req: true, enum: QTYPES }, marks: { t: "int", min: 1, max: 2 },
  stem: { t: "str", req: true }, options: { t: "json", nullable: true }, answer: { t: "str", req: true }, difficulty: { t: "int", min: 1, max: 5 },
  order_in_topic: { t: "int", nullable: true }, quick_method: { t: "str", nullable: true }, solution: { t: "str", nullable: true },
  explanation: { t: "str", nullable: true }, trap_note: { t: "str", nullable: true }, video_url: { t: "str", nullable: true },
  video_start_s: { t: "int", nullable: true }, image_refs: { t: "json", nullable: true }, pdf_ref: { t: "str", nullable: true }, needs_review: { t: "bool" },
  level: { t: "int", min: 1, max: 5, nullable: true }, atoms: { t: "json", nullable: true }, hints: { t: "json", nullable: true }, verified: { t: "bool" },
  answer_check: { t: "str", enum: ["agrees", "disagrees", "unsure"], nullable: true }, answer_check_note: { t: "str", nullable: true },
  answer_source: { t: "str", nullable: true },
  solution_full: { t: "str", nullable: true }, quick_method_full: { t: "str", nullable: true }, explanation_full: { t: "str", nullable: true }, trap_note_full: { t: "str", nullable: true }, in_2027_syllabus: { t: "bool" }, syllabus_note: { t: "str", nullable: true }, discussion_url: { t: "str", nullable: true },
};
export const ATTEMPT: Schema = {
  id: { t: "str" }, question_id: { t: "str", req: true }, given_answer: { t: "str", nullable: true }, time_s: { t: "int", min: 0, nullable: true },
  error_type: { t: "str", enum: ["concept", "calculation", "reading", "time", "guess"], nullable: true }, mode: { t: "str", enum: ["practice", "mock", "revision", "test"] },
  used_hint: { t: "bool" }, mock_id: { t: "str", nullable: true }, notes: { t: "str", nullable: true }, at: { t: "str" }, correct: { t: "bool" },
};

function normAnswer(b: any) {
  if (b && Array.isArray(b.answer)) b.answer = b.answer.join(",");
  if (b && b.answer && typeof b.answer === "object" && Array.isArray(b.answer.ranges)) b.answer = b.answer.ranges.map((r: number[]) => r[0] === r[1] ? String(r[0]) : `${r[0]}..${r[1]}`).join("|");
  return b;
}
function qExtra(rows: any[]) {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const map = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const x of db.query(`SELECT question_id, topic_id FROM question_topics WHERE question_id IN (${chunk.map(() => "?").join(",")})`).all(...chunk) as any[])
      (map.get(x.question_id) ?? map.set(x.question_id, []).get(x.question_id)!).push(x.topic_id);
  }
  return rows.map(r => ({ ...hydrate("questions", r), topic_ids: map.get(r.id) ?? [] }));
}
const getQ = (id: string) => {
  const q = db.query("SELECT * FROM questions WHERE id=? AND deleted_at IS NULL").get(id) as any;
  if (!q) throw notFound("question");
  return q;
};
function setSecondary(id: string, ids: unknown) {
  if (!Array.isArray(ids)) return;
  db.run("DELETE FROM question_topics WHERE question_id=?", [id]);
  for (const t of ids) db.run("INSERT OR IGNORE INTO question_topics(question_id,topic_id) VALUES (?,?)", [id, String(t)]);
}
/** create or upsert (by id, or official natural key). */
function upsertQuestion(raw: any, actor: any): { id: string; created: boolean } {
  raw = normAnswer({ ...raw });
  const p = dehydrate("questions", parse(raw, QUESTION));
  p.source ??= "custom";
  if (p.source === "official" && (!p.paper || p.year == null || !p.session || !p.q_no)) throw new ApiError(422, "validation", "official questions need paper, year, session, q_no");
  let existing: any = raw.id ? db.query("SELECT id FROM questions WHERE id=?").get(raw.id) : null;
  if (!existing && p.source === "official")
    existing = db.query("SELECT id FROM questions WHERE source='official' AND deleted_at IS NULL AND paper=? AND year=? AND session=? AND q_no=?").get(p.paper, p.year, p.session, p.q_no);
  if (existing) {
    const u = updateSql("questions", { ...p, deleted_at: null, updated_at: now() }, "id=?"); db.run(u.sql, [...u.params, existing.id]);
    setSecondary(existing.id, raw.topic_ids);
    return { id: existing.id, created: false };
  }
  const id = raw.id ?? uuid();
  const row = { marks: 1, difficulty: 3, ...p, id, created_by: createdBy(actor), created_at: now(), updated_at: now() };
  const i = insertSql("questions", row); db.run(i.sql, i.params);
  setSecondary(id, raw.topic_ids);
  return { id, created: true };
}

export function questionRoutes() {
  const r = new Hono<Env>();

  r.get("/questions", (c) => {
    const q = (k: string) => c.req.query(k);
    const { limit, offset } = paging(q);
    const where = ["q.deleted_at IS NULL"]; const params: any[] = []; let cte = ""; const cteParams: any[] = [];
    const topic = q("topic_id") ?? q("topic");
    if (topic) {
      cte = "WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT t.id FROM topics t JOIN sub ON t.parent_id=sub.id WHERE t.deleted_at IS NULL) ";
      cteParams.push(topic);
      where.push("(q.topic_id IN (SELECT id FROM sub) OR q.id IN (SELECT question_id FROM question_topics WHERE topic_id IN (SELECT id FROM sub)))");
    }
    for (const [k, col] of [["source", "q.source"], ["paper", "q.paper"], ["year", "q.year"], ["type", "q.type"], ["difficulty", "q.difficulty"], ["session", "q.session"]] as const)
      if (q(k)) { where.push(`${col}=?`); params.push(q(k)); }
    if (q("difficulty_min")) { where.push("q.difficulty>=?"); params.push(Number(q("difficulty_min"))); }
    if (q("difficulty_max")) { where.push("q.difficulty<=?"); params.push(Number(q("difficulty_max"))); }
    if (q("needs_review") !== undefined && q("needs_review") !== "") { where.push("q.needs_review=?"); params.push(q("needs_review") === "1" || q("needs_review") === "true" ? 1 : 0); }
    if (q("in_syllabus") !== undefined && q("in_syllabus") !== "") { where.push("q.in_2027_syllabus=?"); params.push(q("in_syllabus") === "1" || q("in_syllabus") === "true" ? 1 : 0); }
    if (q("level")) { where.push("q.level=?"); params.push(Number(q("level"))); }
    if (q("q")) { where.push("(q.stem LIKE ? OR q.explanation LIKE ? OR q.id LIKE ?)"); const l = `%${q("q")}%`; params.push(l, l, l); }
    const order = q("order") === "difficulty"
      ? "q.difficulty ASC, COALESCE(q.order_in_topic, 1000000) ASC, q.year DESC, q.id ASC"
      : "COALESCE(q.order_in_topic, 1000000), q.year DESC, q.paper, q.session, CAST(q.q_no AS INTEGER), q.id";
    const rows = db.query(`${cte}SELECT q.*,
        (SELECT COUNT(*) FROM attempts a WHERE a.question_id=q.id) AS attempt_count,
        (SELECT a.correct FROM attempts a WHERE a.question_id=q.id ORDER BY a.at DESC LIMIT 1) AS last_correct
      FROM questions q WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...cteParams, ...params, limit + 1, offset) as any[];
    const pg = page(rows, limit, offset);
    return c.json({ ...pg, items: qExtra(pg.items) });
  });
  r.get("/questions/:id", (c) => {
    const row = getQ(c.req.param("id"));
    const stats = db.query("SELECT COUNT(*) attempts, COALESCE(SUM(correct),0) correct, AVG(time_s) avg_time_s FROM attempts WHERE question_id=?").get(row.id);
    const last = db.query("SELECT * FROM attempts WHERE question_id=? ORDER BY at DESC LIMIT 10").all(row.id);
    const mistake = db.query("SELECT * FROM mistakes WHERE question_id=? AND status='open'").get(row.id) ?? null;
    return c.json({ ...qExtra([row])[0], stats, last_attempts: last, open_mistake: mistake });
  });
  r.post("/questions", async (c) => {
    const body = await readJson(c);
    const actor = c.get("actor");
    if (Array.isArray(body?.questions)) {
      if (body.questions.length > 200) throw new ApiError(422, "validation", "max 200 questions per request");
      const res = db.transaction(() => body.questions.map((x: any, i: number) => {
        try { return upsertQuestion(x, actor); } catch (e) { if (e instanceof ApiError) throw new ApiError(e.status, e.code, `questions[${i}]: ${e.message}`, e.details); throw e; }
      }))();
      return c.json({ ids: res.map((x: any) => x.id), created: res.filter((x: any) => x.created).length, updated: res.filter((x: any) => !x.created).length }, 201);
    }
    const { id, created } = db.transaction(() => upsertQuestion(body, actor))();
    return c.json(qExtra([getQ(id)])[0], created ? 201 : 200);
  });
  r.patch("/questions/:id", async (c) => {
    const id = c.req.param("id"); getQ(id);
    const body = normAnswer(await readJson(c));
    const p = dehydrate("questions", parse(body, QUESTION, true));
    db.transaction(() => {
      if (Object.keys(p).length) { const u = updateSql("questions", { ...p, updated_at: now() }, "id=?"); db.run(u.sql, [...u.params, id]); }
      setSecondary(id, body.topic_ids);
    })();
    return c.json(qExtra([getQ(id)])[0]);
  });
  r.delete("/questions/:id", (c) => {
    const id = c.req.param("id"); getQ(id);
    db.run("UPDATE questions SET deleted_at=?, updated_at=? WHERE id=?", [now(), now(), id]);
    return c.body(null, 204);
  });

  // ---- attempts
  r.post("/attempts", async (c) => {
    const p = parse(await readJson(c), ATTEMPT);
    const out = db.transaction(() => createAttempt(p, c.get("actor")))();
    sweepAutoTasks(istDate(p.at ?? now()));
    return c.json(out, (out as any).duplicate ? 200 : 201);
  });
  r.get("/attempts", (c) => {
    const q = (k: string) => c.req.query(k);
    const { limit, offset } = paging(q);
    const where = ["1=1"]; const params: any[] = [];
    if (q("from")) { where.push("date(a.at,'+330 minutes')>=?"); params.push(q("from")); }
    if (q("to")) { where.push("date(a.at,'+330 minutes')<=?"); params.push(q("to")); }
    if (q("question_id")) { where.push("a.question_id=?"); params.push(q("question_id")); }
    if (q("topic_id")) { where.push("qq.topic_id=?"); params.push(q("topic_id")); }
    if (q("correct") !== undefined && q("correct") !== "") { where.push("a.correct=?"); params.push(q("correct") === "1" || q("correct") === "true" ? 1 : 0); }
    if (q("error_type")) { where.push("a.error_type=?"); params.push(q("error_type")); }
    const rows = db.query(`SELECT a.* FROM attempts a JOIN questions qq ON qq.id=a.question_id WHERE ${where.join(" AND ")} ORDER BY a.at DESC LIMIT ? OFFSET ?`).all(...params, limit + 1, offset);
    return c.json(page(rows, limit, offset));
  });
  r.patch("/attempts/:id", async (c) => {
    const id = c.req.param("id");
    const a = db.query("SELECT * FROM attempts WHERE id=?").get(id) as any;
    if (!a) throw notFound("attempt");
    const p = parse(await readJson(c), { error_type: ATTEMPT.error_type!, notes: ATTEMPT.notes!, used_hint: ATTEMPT.used_hint! }, true);
    if (Object.keys(p).length) {
      const u = updateSql("attempts", { ...p, updated_at: now() }, "id=?"); db.run(u.sql, [...u.params, id]);
      if (p.error_type) db.run("UPDATE mistakes SET error_type=?, updated_at=? WHERE attempt_id=? AND status='open'", [p.error_type, now(), id]);
    }
    return c.json(db.query("SELECT * FROM attempts WHERE id=?").get(id));
  });

  // ---- mistakes
  const mistakeOut = (m: any) => ({ ...m, question: qExtra([db.query("SELECT * FROM questions WHERE id=?").get(m.question_id) as any])[0] });
  r.get("/mistakes", (c) => {
    const { limit, offset } = paging(k => c.req.query(k));
    const status = c.req.query("status") ?? "open", due = c.req.query("due") ?? "all";
    const where = ["1=1"]; const params: any[] = [];
    if (status !== "all") { where.push("status=?"); params.push(status); }
    if (due === "today") { where.push("due_on<=?"); params.push(c.req.query("date") && isDate(c.req.query("date")) ? c.req.query("date") : todayIST()); }
    const rows = db.query(`SELECT * FROM mistakes WHERE ${where.join(" AND ")} ORDER BY due_on, created_at LIMIT ? OFFSET ?`).all(...params, limit + 1, offset) as any[];
    const pg = page(rows, limit, offset);
    return c.json({ ...pg, items: pg.items.map(mistakeOut) });
  });
  r.post("/mistakes/:id/review", async (c) => {
    const b = parse(await readJson(c), { correct: { t: "bool", req: true }, at: { t: "str" } });
    return c.json(mistakeOut(db.transaction(() => reviewMistake(c.req.param("id"), !!b.correct, b.at))()));
  });
  r.patch("/mistakes/:id", async (c) => {
    const id = c.req.param("id");
    if (!db.query("SELECT 1 FROM mistakes WHERE id=?").get(id)) throw notFound("mistake");
    const p = parse(await readJson(c), { takeaway: { t: "str", nullable: true }, error_type: { t: "str", enum: ["concept", "calculation", "reading", "time", "guess"], nullable: true }, status: { t: "str", enum: ["open", "retired"] } }, true);
    if (Object.keys(p).length) { const u = updateSql("mistakes", { ...p, updated_at: now() }, "id=?"); db.run(u.sql, [...u.params, id]); }
    return c.json(mistakeOut(db.query("SELECT * FROM mistakes WHERE id=?").get(id)));
  });
  return r;
}

// ---- media (mounted at /media, authenticated)
const mediaDir = () => join(config.dataDir, "media");
const IMG_OK = /^[A-Za-z0-9._-]+$/;
function serveFile(c: any, path: string) {
  const f = Bun.file(path);
  return new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" } });
}
export function mediaRoutes() {
  const r = new Hono<Env>();
  r.get("/img/:file", async (c) => {
    const name = basename(c.req.param("file"));
    if (!IMG_OK.test(name)) throw notFound("image");
    for (const dir of [join(config.dataDir, "img"), config.devImgDir]) {
      const p = join(dir, name);
      if (existsSync(p)) return serveFile(c, p);
    }
    throw notFound("image");
  });
  r.get("/:name", (c) => {
    const name = basename(c.req.param("name"));
    const p = join(mediaDir(), name);
    if (!IMG_OK.test(name) || !existsSync(p)) throw notFound("media");
    return serveFile(c, p);
  });
  return r;
}
export function mediaUploadRoute() {
  const r = new Hono<Env>();
  r.post("/media", async (c) => {
    const body = await c.req.parseBody();
    const f = body["file"];
    if (!(f instanceof File)) throw new ApiError(422, "validation", "multipart field `file` is required");
    const ext = (f.name.split(".").pop() ?? "").toLowerCase();
    if (!["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) throw new ApiError(422, "validation", "only png/jpg/jpeg/webp/gif are accepted");
    if (f.size > 10 * 1024 * 1024) throw new ApiError(422, "validation", "max 10 MB");
    const buf = new Uint8Array(await f.arrayBuffer());
    const sha = createHash("sha256").update(buf).digest("hex").slice(0, 8);
    mkdirSync(mediaDir(), { recursive: true });
    const name = `${sha}.${ext}`;
    await Bun.write(join(mediaDir(), name), buf);
    return c.json({ path: `media/${name}`, url: `/media/${name}` }, 201);
  });
  return r;
}
