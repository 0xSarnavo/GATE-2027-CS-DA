import { Hono } from "hono";
import type { Env } from "../../auth";
import { db } from "../../db";
import { notFound } from "../../errors";
import { now } from "../../util";

/** Practice module: a star on any question. */
export function bookmarkRoutes() {
  const r = new Hono<Env>();
  r.get("/bookmarks", (c) => c.json({ items: db.query("SELECT question_id, created_at FROM bookmarks ORDER BY created_at DESC").all() }));
  r.put("/bookmarks/:qid", (c) => {
    const id = c.req.param("qid");
    if (!db.query("SELECT 1 FROM questions WHERE id=? AND deleted_at IS NULL").get(id)) throw notFound("question");
    db.run("INSERT OR IGNORE INTO bookmarks(question_id,created_at) VALUES (?,?)", [id, now()]);
    return c.json({ question_id: id, bookmarked: true });
  });
  r.delete("/bookmarks/:qid", (c) => { db.run("DELETE FROM bookmarks WHERE question_id=?", [c.req.param("qid")]); return c.body(null, 204); });
  return r;
}
