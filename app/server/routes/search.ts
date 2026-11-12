import { Hono } from "hono";
import { db } from "../db";
import type { Env } from "../auth";

export function searchRoutes() {
  const r = new Hono<Env>();
  r.get("/search", c => {
    const q = (c.req.query("q") ?? "").trim().slice(0, 100);
    const limit = Math.min(8, Math.max(1, Number.parseInt(c.req.query("limit") ?? "8", 10) || 8));
    if (q.length < 2) return c.json({ chapters: [], concepts: [], questions: [] });
    const escaped = q.replace(/[\\%_]/g, "\\$&");
    const match = `%${escaped}%`, prefix = `${escaped}%`;
    const chapters = db.query(`SELECT id, name, parent_id FROM topics WHERE deleted_at IS NULL AND name LIKE ? ESCAPE '\\'
      ORDER BY CASE WHEN lower(name)=lower(?) THEN 0 WHEN name LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, name LIMIT ?`).all(match, q, prefix, limit);
    const concepts = db.query(`WITH atoms AS (
      SELECT n.topic_id, json_extract(a.value,'$.id') atom_id, json_extract(a.value,'$.name') name,
        json_extract(a.value,'$.one_line') snippet FROM topic_notes n, json_each(CASE WHEN json_valid(n.atoms) THEN n.atoms ELSE '[]' END) a
      UNION ALL
      SELECT e.topic_id, json_extract(a.value,'$.atom_id'), json_extract(a.value,'$.title'),
        json_extract(a.value,'$.simple') FROM topic_explainers e, json_each(CASE WHEN json_valid(e.data) THEN e.data ELSE '{}' END,'$.cards') a
    ), matches AS (
      SELECT a.topic_id, a.atom_id, a.name, a.snippet, t.name topic_name,
        ROW_NUMBER() OVER (PARTITION BY a.topic_id,a.atom_id ORDER BY CASE WHEN lower(a.name)=lower(?) THEN 0 WHEN a.name LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END) slot
      FROM atoms a JOIN topics t ON t.id=a.topic_id
      WHERE t.deleted_at IS NULL AND a.atom_id IS NOT NULL AND (a.name LIKE ? ESCAPE '\\' OR a.snippet LIKE ? ESCAPE '\\')
    ) SELECT topic_id,atom_id,name,snippet,topic_name FROM matches WHERE slot=1
      ORDER BY CASE WHEN lower(name)=lower(?) THEN 0 WHEN name LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, name LIMIT ?`).all(q, prefix, match, match, q, prefix, limit);
    const questions = db.query(`SELECT q.id, q.topic_id, q.stem AS snippet, t.name topic_name FROM questions q JOIN topics t ON t.id=q.topic_id
      WHERE q.deleted_at IS NULL AND t.deleted_at IS NULL AND q.stem LIKE ? ESCAPE '\\'
      ORDER BY CASE WHEN lower(q.stem)=lower(?) THEN 0 WHEN q.stem LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, q.id LIMIT ?`).all(match, q, prefix, limit);
    return c.json({ chapters, concepts, questions });
  });
  return r;
}
