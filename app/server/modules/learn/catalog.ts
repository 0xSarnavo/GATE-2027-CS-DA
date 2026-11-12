import { db } from '../../db';

type Video = Record<string, any> & { concepts: { atom_id: string; start_s: number; note: string | null }[] };
const recent = (v: Video) => /^202[5-7]/.test(v.published || '') ? 1 : 0;
const rank = (a: Video, b: Video) =>
  Number(!!b.start_s) - Number(!!a.start_s) || recent(b) - recent(a) ||
  (b.published || '').localeCompare(a.published || '') || (a.level ?? 99) - (b.level ?? 99) || (a.sort ?? 0) - (b.sort ?? 0);

export function chapterCatalog(topic: string) {
  const note = db.query('SELECT atoms FROM topic_notes WHERE topic_id=?').get(topic) as { atoms?: string } | null;
  let atoms: { id: string; name: string }[] = [];
  try { atoms = JSON.parse(note?.atoms || '[]') || []; } catch { /* incomplete content */ }
  const rows = db.query('SELECT * FROM videos WHERE topic_id=? AND deleted_at IS NULL').all(topic) as Video[];
  const maps = db.query(`SELECT video_id,atom_id,start_s,note FROM video_concepts WHERE topic_id=? ORDER BY start_s`).all(topic) as { video_id: string; atom_id: string; start_s: number; note: string | null }[];
  const videos: Video[] = rows.map(v => ({ ...v, concepts: maps.filter(m => m.video_id === v.id).map(({ atom_id, start_s, note }) => ({ atom_id, start_s, note })) }));
  const concepts = atoms.map(atom => {
    const candidates = videos.flatMap(v => v.concepts.filter(c => c.atom_id === atom.id).map(c => ({ ...v, start_s: c.start_s })));
    return { atom_id: atom.id, name: atom.name, video: candidates.sort(rank)[0] ?? null };
  });
  const full_lectures = videos.filter(v => atoms.length && v.concepts.length / atoms.length >= .6 || !v.concepts.length && (v.duration_s ?? 0) > 1500).sort(rank);
  const full = new Set(full_lectures.map(v => v.id));
  const more_videos = videos.filter(v => !full.has(v.id)).sort(rank);
  return { topic_id: topic, concepts, full_lectures, more_videos };
}

export function bestConceptVideo(topic: string, atom: string) {
  return videosForConcept(topic, atom)[0] ?? null;
}

export function videosForConcept(topic: string, atom: string) {
  const catalog = chapterCatalog(topic);
  return [...catalog.full_lectures, ...catalog.more_videos]
    .flatMap(v => v.concepts.filter(c => c.atom_id === atom).map(c => ({ ...v, start_s: c.start_s }))).sort(rank);
}

export function subjectCourse(subject: string) {
  const chapters = db.query(`WITH RECURSIVE tree AS (
    SELECT id,parent_id,name,sort FROM topics WHERE id=? AND deleted_at IS NULL
    UNION ALL SELECT t.id,t.parent_id,t.name,t.sort FROM topics t JOIN tree p ON t.parent_id=p.id WHERE t.deleted_at IS NULL
  ) SELECT tree.id,tree.name,tree.sort,(SELECT MIN(date) FROM plan_tasks p WHERE p.topic_id=tree.id AND p.deleted_at IS NULL) AS plan_date
  FROM tree WHERE tree.id<>? AND NOT EXISTS(SELECT 1 FROM topics child WHERE child.parent_id=tree.id AND child.deleted_at IS NULL)
  ORDER BY (plan_date IS NULL),plan_date,sort,id`).all(subject, subject) as { id: string; name: string }[];
  return { subject_id: subject, chapters: chapters.map(c => ({ ...c, ...chapterCatalog(c.id) })) };
}
