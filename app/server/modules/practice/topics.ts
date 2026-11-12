import { Hono } from "hono";
import { db } from "../../db";
import type { Env } from "../../auth";
import { notFound } from "../../errors";
import { parse, readJson, type Schema } from "../../validate";
import { now, hydrate } from "../../util";
import { crud } from "../../routes/crud";

const SCOPE = ["shared", "cs", "da"] as const;
const TOPIC: Schema = {
  subject_id: { t: "str", req: true }, parent_id: { t: "str", nullable: true }, name: { t: "str", req: true },
  scope: { t: "str", req: true, enum: SCOPE }, sort: { t: "int" }, est_minutes: { t: "int", min: 0, nullable: true }, notes: { t: "str", nullable: true },
};
const PROGRESS: Schema = {
  status: { t: "str", enum: ["todo", "learning", "practising", "revised", "mastered"] },
  confidence: { t: "int", min: 1, max: 5, nullable: true }, last_studied_on: { t: "date", nullable: true },
};

export function topicRoutes() {
  const r = new Hono<Env>();
  r.get("/subjects", (c) => c.json({ items: db.query("SELECT id,name,COALESCE(scope_override,scope) AS scope,sort FROM subjects ORDER BY sort, id").all(), next: null }));

  r.get("/topics", (c) => {
    const where = ["t.deleted_at IS NULL"]; const params: any[] = [];
    const scope = c.req.query("scope"), subject = c.req.query("subject");
    if (scope) { where.push("(COALESCE(t.scope_override,t.scope)=? OR (COALESCE(t.scope_override,t.scope)='shared' AND ?<>'foundation'))"); params.push(scope, scope); }
    if (subject) { where.push("t.subject_id=?"); params.push(subject); }
    const rows = db.query(`SELECT t.*, COALESCE(t.scope_override,t.scope) AS scope, p.status AS p_status, p.confidence AS p_conf, p.questions_done AS p_done, p.questions_correct AS p_correct, p.last_studied_on AS p_last,
        (SELECT COUNT(*) FROM questions q WHERE q.topic_id=t.id AND q.deleted_at IS NULL) AS question_count,
        (SELECT COUNT(*) FROM questions q WHERE q.topic_id=t.id AND q.deleted_at IS NULL AND q.source='official') AS official_count,
        (SELECT COUNT(*) FROM videos v WHERE v.topic_id=t.id AND v.deleted_at IS NULL) AS video_count
      FROM topics t LEFT JOIN topic_progress p ON p.topic_id=t.id WHERE ${where.join(" AND ")} ORDER BY t.subject_id, t.sort, t.id`).all(...params) as any[];
    const kids = new Map<string, string[]>();
    for (const t of rows) if (t.parent_id) (kids.get(t.parent_id) ?? kids.set(t.parent_id, []).get(t.parent_id)!).push(t.id);
    const items = rows.map(t => {
      const { p_status, p_conf, p_done, p_correct, p_last, scope_override, ...rest } = t;
      return { ...rest, children: kids.get(t.id) ?? [],
        progress: { status: p_status ?? "todo", confidence: p_conf ?? null, questions_done: p_done ?? 0, questions_correct: p_correct ?? 0, last_studied_on: p_last ?? null } };
    });
    return c.json({ items, next: null, subjects: db.query("SELECT id,name,COALESCE(scope_override,scope) AS scope,sort FROM subjects ORDER BY sort, id").all() });
  });
  r.get("/topics/:id/prereqs", (c) => {
    const id = c.req.param("id");
    if (!db.query("SELECT 1 FROM topics WHERE id=? AND deleted_at IS NULL").get(id)) throw notFound("topic");
    const items = db.query(`SELECT p.prereq_id AS id, p.kind, t.name, COALESCE(t.scope_override,t.scope) AS scope,
      tp.status, COUNT(n.value) AS concept_total, COUNT(cp.atom_id) AS got_it,
      (SELECT ROUND(AVG(cm.score)) FROM concept_mastery cm WHERE cm.topic_id=t.id AND cm.date=(SELECT MAX(date) FROM concept_mastery WHERE topic_id=t.id)) AS mastery
      FROM topic_prereqs p JOIN topics t ON t.id=p.prereq_id
      LEFT JOIN topic_progress tp ON tp.topic_id=t.id
      LEFT JOIN topic_notes tn ON tn.topic_id=t.id
      LEFT JOIN json_each(CASE WHEN json_valid(tn.atoms) THEN tn.atoms ELSE '[]' END) n ON 1=1
      LEFT JOIN concept_progress cp ON cp.topic_id=t.id AND cp.atom_id=json_extract(n.value,'$.id') AND cp.status='got_it'
      WHERE p.topic_id=? AND t.deleted_at IS NULL GROUP BY p.prereq_id ORDER BY CASE p.kind WHEN 'foundation' THEN 0 ELSE 1 END,p.sort`).all(id) as any[];
    return c.json({ chapter_id: id, foundations: items.filter(x => x.kind === "foundation").map(x => ({ ...x, ready: x.status === "mastered" || (x.concept_total > 0 && x.got_it === x.concept_total) })),
      chapters: items.filter(x => x.kind === "chapter").map(x => ({ ...x, ready: x.status === "mastered" || (x.concept_total > 0 && x.got_it === x.concept_total) })) });
  });
  r.get("/topics/:id/blueprint", (c) => {
    const id = c.req.param("id");
    if (!db.query("SELECT 1 FROM topics WHERE id=? AND deleted_at IS NULL").get(id)) throw notFound("topic");
    const row = db.query("SELECT * FROM topic_notes WHERE topic_id=?").get(id);
    return c.json(hydrate("topic_notes", row as any) ?? { topic_id: id, summary_md: null, atoms: null, patterns: null, traps: null, hardest_pyq: null });
  });
  r.put("/topics/:id/progress", async (c) => {
    const id = c.req.param("id");
    if (!db.query("SELECT 1 FROM topics WHERE id=? AND deleted_at IS NULL").get(id)) throw notFound("topic");
    const p = parse(await readJson(c), PROGRESS, true);
    db.run("INSERT OR IGNORE INTO topic_progress(topic_id,status,updated_at) VALUES (?, 'todo', ?)", [id, now()]);
    const cols = Object.keys(p);
    if (cols.length) db.run(`UPDATE topic_progress SET ${cols.map(k => `${k}=?`).join(",")}, updated_at=? WHERE topic_id=?`, [...cols.map(k => p[k]), now(), id]);
    return c.json(db.query("SELECT * FROM topic_progress WHERE topic_id=?").get(id));
  });
  r.route("/", crud({ table: "topics", path: "/topics", schema: TOPIC, order: "subject_id, sort, id", filters: { subject: "subject_id=?" } }));
  return r;
}
