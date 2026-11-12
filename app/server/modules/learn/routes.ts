import { Hono } from "hono";
import type { Env } from "../../auth";
import { db } from "../../db";
import { notFound } from "../../errors";
import { readJson, parse, type Schema } from "../../validate";
import { crud } from "../../routes/crud";
import { now } from '../../util';
import { bestConceptVideo, chapterCatalog, subjectCourse, videosForConcept } from './catalog';

const VIDEO: Schema = {
  topic_id: { t: "str", nullable: true }, subject_id: { t: "str", nullable: true }, title: { t: "str", nullable: true }, url: { t: "str", req: true },
  source: { t: "str", nullable: true }, role: { t: "str", enum: ["concept", "worked-example", "intuition"] }, language: { t: "str" },
  watched: { t: "bool" }, sort: { t: "int" }, channel: { t: "str", nullable: true }, lang: { t: "str", nullable: true },
  published: { t: "str", nullable: true }, duration_s: { t: "int", nullable: true }, level: { t: "int", nullable: true }, why: { t: "str", nullable: true },
};
export function learnRoutes() {
  const r = new Hono<Env>();
  r.get("/topics/:id/explainer", (c) => {
    const id = c.req.param("id");
    if (!db.query("SELECT 1 FROM topics WHERE id=? AND deleted_at IS NULL").get(id)) throw notFound("topic");
    const row = db.query("SELECT data FROM topic_explainers WHERE topic_id=?").get(id) as any;
    return c.json(row ? JSON.parse(row.data) : { topic_id: id, title: null, cards: [], scenes: [] });
  });
  r.get("/videos/for-concept", c => {
    const topic=c.req.query('topic_id'), atom=c.req.query('atom_id');
    if (!topic || !atom) return c.json({video:null});
    return c.json({video:bestConceptVideo(topic,atom)});
  });
  r.get("/videos/for-question/:id", c => {
    const q=db.query('SELECT topic_id,atoms,video_url,video_start_s FROM questions WHERE id=? AND deleted_at IS NULL').get(c.req.param('id')) as any;
    if (!q) throw notFound('question');
    let atoms:string[]=[]; try { atoms=JSON.parse(q.atoms || '[]'); } catch { /* empty */ }
    const atom=atoms[0];
    const row=atom ? bestConceptVideo(q.topic_id,atom) : null;
    return c.json({video:row ?? (q.video_url ? {url:q.video_url,start_s:q.video_start_s||0,title:null} : null)});
  });
  r.get('/videos/chapter', c => c.json(chapterCatalog(c.req.query('topic_id') || '')));
  r.get('/videos/concept', c => c.json({ items: videosForConcept(c.req.query('topic_id') || '', c.req.query('atom_id') || '') }));
  r.get('/videos/course', c => c.json(subjectCourse(c.req.query('subject_id') || '')));
  r.get('/videos/progress', c => c.json({ items: db.query('SELECT * FROM video_progress ORDER BY updated_at DESC').all() }));
  r.put('/videos/progress', async c => {
    const p = parse(await readJson(c), { video_id: { t: 'str', req: true }, position_s: { t: 'int', req: true, min: 0 }, completed: { t: 'bool' } });
    if (!db.query('SELECT 1 FROM videos WHERE id=? AND deleted_at IS NULL').get(p.video_id)) throw notFound('video');
    const old = db.query('SELECT completed FROM video_progress WHERE video_id=?').get(p.video_id) as { completed: number } | null;
    db.run(`INSERT INTO video_progress(video_id,position_s,completed,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(video_id) DO UPDATE SET position_s=excluded.position_s,completed=excluded.completed,updated_at=excluded.updated_at`,
      [p.video_id,p.position_s,p.completed ?? old?.completed ?? 0,now()]);
    return c.json(db.query('SELECT * FROM video_progress WHERE video_id=?').get(p.video_id));
  });
  r.route("/", crud({ table: "videos", path: "/videos", schema: VIDEO, bulkKey: "videos", order: "topic_id, sort, id", filters: { topic_id: "topic_id=?", subject_id: "subject_id=?" } }));
  return r;
}
