import { Hono } from "hono";
import { db } from "../../db";
import type { Env } from "../../auth";
import { ApiError } from "../../errors";
import { parse, readJson, type Schema } from "../../validate";
import { hydrate, now, todayIST, uuid, istDate } from "../../util";
import { sweepAutoTasks } from '../planner/auto';
import { dueCounts, nextIntervals, newCardsLeftToday, reviewCard } from "../../lib/services";
import { crud } from "../../routes/crud";

const CARD: Schema = {
  topic_id: { t: "str", nullable: true }, kind: { t: "str", enum: ["qa", "pair", "cloze"] }, front: { t: "str", req: true }, back: { t: "str", req: true },
  hint: { t: "str", nullable: true }, tags: { t: "json" }, game_ok: { t: "bool" },
};
const subtree = "WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT t.id FROM topics t JOIN sub ON t.parent_id=sub.id WHERE t.deleted_at IS NULL) ";

export function cardRoutes() {
  const r = new Hono<Env>();

  r.get("/cards/due", (c) => {
    const today = todayIST();
    const limit = Math.min(200, Number(c.req.query("limit")) || 30);
    const topic = c.req.query("topic_id");
    const tf = topic ? " AND topic_id IN (SELECT id FROM sub)" : "";
    const pre = topic ? subtree : ""; const tp = topic ? [topic] : [];
    const due = db.query(`${pre}SELECT * FROM cards WHERE deleted_at IS NULL AND due_on<=? AND last_reviewed_on IS NOT NULL${tf} ORDER BY due_on, id LIMIT ?`).all(...tp, today, limit) as any[];
    const room = Math.max(0, Math.min(limit - due.length, newCardsLeftToday(today)));
    const fresh = room ? db.query(`${pre}SELECT * FROM cards WHERE deleted_at IS NULL AND due_on<=? AND last_reviewed_on IS NULL${tf} ORDER BY created_at, id LIMIT ?`).all(...tp, today, room) as any[] : [];
    const items = [...due, ...fresh].map(x => ({ ...hydrate("cards", x), next_intervals: nextIntervals(x), is_new: x.last_reviewed_on == null }));
    return c.json({ items, next: null, counts: { due: due.length, new: fresh.length, ...dueCounts(today) } });
  });

  r.get("/cards", (c) => {
    const q = (k: string) => c.req.query(k);
    const limit = Math.min(1000, Number(q("limit")) || 100), offset = Math.max(0, Number(q("cursor")) || 0);
    const where = ["deleted_at IS NULL"]; const params: any[] = []; let pre = ""; const pp: any[] = [];
    if (q("topic_id")) { pre = subtree; pp.push(q("topic_id")); where.push("topic_id IN (SELECT id FROM sub)"); }
    if (q("kind")) { where.push("kind=?"); params.push(q("kind")); }
    if (q("due") === "today") { where.push("due_on<=?"); params.push(todayIST()); }
    const rows = db.query(`${pre}SELECT * FROM cards WHERE ${where.join(" AND ")} ORDER BY due_on, id LIMIT ? OFFSET ?`).all(...pp, ...params, limit + 1, offset) as any[];
    const more = rows.length > limit;
    return c.json({ items: (more ? rows.slice(0, limit) : rows).map(x => hydrate("cards", x)), next: more ? String(offset + limit) : null });
  });

  r.post("/cards/:id/review", async (c) => {
    const b = parse(await readJson(c), {
      grade: { t: "int", min: 0, max: 5 }, time_ms: { t: "int", min: 0, nullable: true }, mode: { t: "str", enum: ["review", "match", "recall"] },
      correct: { t: "bool" }, at: { t: "str" }, review_id: { t: "str" },
    });
    const card = reviewCard(c.req.param("id"), b);
    sweepAutoTasks(istDate(b.at ?? now()));
    return c.json({ ...hydrate("cards", card), next_intervals: nextIntervals(card) });
  });

  r.get("/games/pairs", (c) => {
    const n = Math.min(12, Math.max(2, Number(c.req.query("n")) || 6));
    const topic = c.req.query("topic_id");
    const tf = topic ? " AND topic_id IN (SELECT id FROM sub)" : "";
    const rows = db.query(`${topic ? subtree : ""}SELECT id, front, back FROM cards WHERE deleted_at IS NULL AND game_ok=1 AND (kind='pair' OR (kind='qa' AND length(front)<=48 AND length(back)<=48))${tf} ORDER BY RANDOM() LIMIT ?`)
      .all(...(topic ? [topic] : []), n) as any[];
    return c.json({ round: rows.map(x => ({ card_id: x.id, left: x.front, right: x.back })) });
  });
  r.post("/games/scores", async (c) => {
    const b = parse(await readJson(c), {
      game: { t: "str", req: true }, topic_id: { t: "str", nullable: true }, score: { t: "int", nullable: true }, duration_s: { t: "int", nullable: true },
      detail: { t: "json", nullable: true }, id: { t: "str" }, at: { t: "str" },
    });
    const id = b.id ?? uuid();
    if (!db.query("SELECT 1 FROM game_scores WHERE id=?").get(id))
      db.run("INSERT INTO game_scores(id,game,at,topic_id,score,duration_s,detail,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        [id, b.game, b.at ?? now(), b.topic_id ?? null, b.score ?? null, b.duration_s ?? null, b.detail == null ? null : typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail), now()]);
    return c.json(db.query("SELECT * FROM game_scores WHERE id=?").get(id), 201);
  });

  const crudCards = crud({ table: "cards", path: "/cards", schema: CARD, bulkKey: "cards", defaults: { due_on: todayIST() }, order: "due_on, id" });
  r.route("/", crudCards);
  void ApiError;
  return r;
}
