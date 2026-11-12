import { Hono } from "hono";
import type { Env } from "../../auth";
import { db } from "../../db";
import { notFound, validation } from "../../errors";
import { readJson } from "../../validate";
import { now } from "../../util";

const topicExists = (id: string) => { if (!db.query("SELECT 1 FROM topics WHERE id=? AND deleted_at IS NULL").get(id)) throw notFound("topic"); };

/** Learn module: my chapter notes and per-concept "Got it" progress (concept = blueprint atom of a chapter). */
export function progressRoutes() {
  const r = new Hono<Env>();
  r.get("/topics/:id/note", (c) => {
    const id = c.req.param("id"); topicExists(id);
    return c.json((db.query("SELECT topic_id, body, updated_at FROM topic_user_notes WHERE topic_id=?").get(id) as any) ?? { topic_id: id, body: "", updated_at: null });
  });
  r.put("/topics/:id/note", async (c) => {
    const id = c.req.param("id"); topicExists(id);
    const b = await readJson(c);
    if (typeof b?.body !== "string") throw validation("body must be a string");
    if (b.body.length > 20000) throw validation("body too long (max 20000)");
    db.run("INSERT INTO topic_user_notes(topic_id,body,updated_at) VALUES (?,?,?) ON CONFLICT(topic_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at", [id, b.body, now()]);
    return c.json(db.query("SELECT topic_id, body, updated_at FROM topic_user_notes WHERE topic_id=?").get(id));
  });
  r.get("/notes", (c) => c.json({ items: db.query("SELECT topic_id, body, updated_at FROM topic_user_notes WHERE body<>'' ORDER BY updated_at DESC").all() }));

  /** Every concept (blueprint atom) with its chapter and whether an explainer card exists for it. */
  r.get("/concepts", (c) => {
    const cards = new Map<string, Set<string>>();
    for (const e of db.query("SELECT topic_id, data FROM topic_explainers").all() as any[]) {
      try { cards.set(e.topic_id, new Set((JSON.parse(e.data).cards ?? []).map((x: any) => String(x.atom_id)).filter(Boolean))); } catch { /* skip bad file */ }
    }
    const items: any[] = [];
    for (const n of db.query("SELECT n.topic_id, n.atoms FROM topic_notes n JOIN topics t ON t.id=n.topic_id WHERE t.deleted_at IS NULL AND n.atoms IS NOT NULL").all() as any[]) {
      let atoms: any[] = []; try { atoms = JSON.parse(n.atoms) ?? []; } catch { /* ignore */ }
      for (const a of atoms) items.push({ topic_id: n.topic_id, atom_id: String(a.id), name: a.name, one_line: a.one_line ?? "", has_card: !!cards.get(n.topic_id)?.has(String(a.id)) });
    }
    const chapters = (db.query("SELECT n.topic_id, n.summary_md FROM topic_notes n JOIN topics t ON t.id=n.topic_id WHERE t.deleted_at IS NULL AND n.summary_md IS NOT NULL").all() as any[])
      .map(x => ({ topic_id: x.topic_id, summary: String(x.summary_md).replace(/\s+/g, " ").slice(0, 160) }));
    return c.json({ items, chapters });
  });
  r.get("/concepts/progress", (c) => {
    const topic = c.req.query("topic_id");
    const rows = topic ? db.query("SELECT topic_id, atom_id, status, updated_at FROM concept_progress WHERE topic_id=?").all(topic) : db.query("SELECT topic_id, atom_id, status, updated_at FROM concept_progress").all();
    return c.json({ items: rows });
  });
  r.put("/concepts/:topic/:atom", async (c) => {
    const topic = c.req.param("topic"), atom = c.req.param("atom"); topicExists(topic);
    const b = await readJson(c).catch(() => ({}));
    const status = b?.status === undefined ? "got_it" : b.status;
    if (status === null) { db.run("DELETE FROM concept_progress WHERE topic_id=? AND atom_id=?", [topic, atom]); return c.json({ topic_id: topic, atom_id: atom, status: null }); }
    if (!["got_it", "learning"].includes(status)) throw validation("status must be got_it, learning or null");
    db.run("INSERT INTO concept_progress(topic_id,atom_id,status,updated_at) VALUES (?,?,?,?) ON CONFLICT(topic_id,atom_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at", [topic, atom, status, now()]);
    return c.json({ topic_id: topic, atom_id: atom, status });
  });
  r.delete("/concepts/:topic/:atom", (c) => { db.run("DELETE FROM concept_progress WHERE topic_id=? AND atom_id=?", [c.req.param("topic"), c.req.param("atom")]); return c.body(null, 204); });
  return r;
}
