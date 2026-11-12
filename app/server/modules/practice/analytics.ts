import { Hono } from 'hono';
import type { Env } from '../../auth';
import { db } from '../../db';
import { addDays, dateParam, todayIST } from '../../util';
import { readWeightage } from './weightage';

export type MasteryAttempt = { correct: number; used_hint?: number; difficulty: number; at: string };
/** Difficulty weights L1=0.6 through L5=1.4; a hinted correct answer earns half credit. */
export function masteryScore(attempts: MasteryAttempt[], asOf = new Date()): number {
  let earned = 0, possible = 0;
  for (const a of attempts) {
    const age = Math.max(0, (asOf.getTime() - Date.parse(a.at)) / 864e5);
    const weight = Math.pow(0.5, age / 14) * (0.4 + 0.2 * Math.max(1, Math.min(5, a.difficulty || 3)));
    possible += weight; earned += weight * (a.correct ? a.used_hint ? 0.5 : 1 : 0);
  }
  return possible ? Math.round(100 * earned / possible) : 0;
}
export function rankPriority(rows: { topic_id: string; subject_weight: number; accuracy: number; hours_remaining: number }[]) {
  return rows.map(x => ({ ...x, expected_gain: Math.round(100 * x.subject_weight * (1 - x.accuracy) / Math.max(0.25, x.hours_remaining)) / 100 }))
    .sort((a, b) => b.expected_gain - a.expected_gain || a.topic_id.localeCompare(b.topic_id));
}
const atoms = (v: string | null): string[] => { try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x.filter((a): a is string => typeof a === 'string') : []; } catch { return []; } };
export function masteryRows(day = todayIST()) {
  const asOf = new Date(day + 'T18:29:59.999Z');
  const topics = db.query(`SELECT t.id topic_id,t.name,t.subject_id,n.atoms FROM topics t JOIN topic_notes n ON n.topic_id=t.id WHERE t.deleted_at IS NULL`).all() as any[];
  const attempts = db.query(`SELECT q.topic_id,q.atoms,q.difficulty,a.correct,a.used_hint,a.at FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.at<=? AND q.deleted_at IS NULL`).all(asOf.toISOString()) as any[];
  const byAtom = new Map<string, MasteryAttempt[]>();
  for (const a of attempts) for (const atom of atoms(a.atoms)) { const key = a.topic_id + '/' + atom; const list = byAtom.get(key) ?? []; list.push(a); byAtom.set(key, list); }
  const out: any[] = [];
  for (const t of topics) {
    let definitions: any[] = []; try { definitions = JSON.parse(t.atoms || '[]'); } catch { /* empty */ }
    for (const a of Array.isArray(definitions) ? definitions : []) {
      if (typeof a?.id !== 'string' || !a.id) continue;
      const list = byAtom.get(t.topic_id + '/' + a.id) ?? [];
      out.push({ topic_id: t.topic_id, topic_name: t.name, subject_id: t.subject_id, atom_id: a.id, atom_name: a.name, score: masteryScore(list, asOf), attempts: list.length });
    }
  }
  return out;
}
export function chapterMasteryRows(day = todayIST()) {
  const asOf = new Date(day+'T18:29:59.999Z');
  const rows = db.query(`SELECT q.topic_id,t.name,a.correct,a.used_hint,q.difficulty,a.at FROM attempts a JOIN questions q ON q.id=a.question_id JOIN topics t ON t.id=q.topic_id WHERE a.at<=? AND q.deleted_at IS NULL`).all(asOf.toISOString()) as any[];
  const by=new Map<string,any[]>(); for(const x of rows){const a=by.get(x.topic_id)??[];a.push(x);by.set(x.topic_id,a)}
  const chapters=db.query(`SELECT id,name FROM topics WHERE parent_id IS NOT NULL AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM topics c WHERE c.parent_id=topics.id AND c.deleted_at IS NULL)`).all() as {id:string;name:string}[];
  return chapters.map(x=>({topic_id:x.id,name:x.name,score:masteryScore(by.get(x.id)??[],asOf),attempts:by.get(x.id)?.length??0}));
}
export function snapshotMastery(day = todayIST()) {
  const rows = masteryRows(day);
  db.transaction(() => { const put = db.query('INSERT INTO concept_mastery(date,topic_id,atom_id,score,attempts) VALUES (?,?,?,?,?) ON CONFLICT(date,topic_id,atom_id) DO UPDATE SET score=excluded.score,attempts=excluded.attempts');
    for (const x of rows) put.run(day, x.topic_id, x.atom_id, x.score, x.attempts);
  })();
  return rows;
}
export function priorityRows(paper: 'CS' | 'DA' = 'CS') {
  const w = readWeightage()[paper]; if (!w) return [];
  const topics = db.query(`SELECT id,name,subject_id,est_minutes FROM topics WHERE deleted_at IS NULL AND parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM topics c WHERE c.parent_id=topics.id AND c.deleted_at IS NULL)`).all() as any[];
  const acc = db.query(`SELECT q.topic_id,COUNT(*) n,SUM(a.correct) correct_count FROM attempts a JOIN questions q ON q.id=a.question_id GROUP BY q.topic_id`).all() as any[];
  const done = db.query(`SELECT topic_id,SUM(done_minutes) m FROM plan_tasks WHERE status='done' AND deleted_at IS NULL GROUP BY topic_id`).all() as any[];
  const am = new Map(acc.map(x => [x.topic_id, x])); const dm = new Map(done.map(x => [x.topic_id, x.m]));
  return rankPriority(topics.filter(t => w.subjects[t.subject_id]).map(t => ({
    topic_id: t.id, name: t.name, subject_id: t.subject_id, paper,
    subject_weight: w.subjects[t.subject_id]!, accuracy: am.get(t.id)?.n ? am.get(t.id).correct_count / am.get(t.id).n : 0,
    hours_remaining: Math.max(0.25, ((t.est_minutes || 120) - (dm.get(t.id) || 0)) / 60), attempts: am.get(t.id)?.n || 0,
  })));
}
export function studyNext(day = todayIST()) {
  const rows = snapshotMastery(day);
  const week = db.query('SELECT start_date,end_date FROM weeks WHERE start_date<=? AND end_date>=? LIMIT 1').get(day,day) as any;
  const weekStart = week?.start_date ?? day, weekEnd = week?.end_date ?? addDays(day,6);
  const planned = new Set((db.query(`SELECT DISTINCT topic_id FROM plan_tasks WHERE date BETWEEN ? AND ? AND topic_id IS NOT NULL AND deleted_at IS NULL`).all(weekStart, weekEnd) as any[]).map(x => x.topic_id));
  return rows.filter(x => planned.has(x.topic_id)).sort((a,b) => a.score-b.score)[0]
    ?? rows.filter(x => x.attempts > 0 && x.score < 50).sort((a,b) => a.score-b.score)[0] ?? null;
}
export function practiceAnalyticsRoutes() {
  const r = new Hono<Env>();
  r.get('/mastery', c => { const day = dateParam(c.req.query('date'), 'date', todayIST()); const items = snapshotMastery(day);
    const chapters = chapterMasteryRows(day);
    return c.json({ date:day, items, chapters, study_next:studyNext(day) }); });
  r.get('/priority', c => c.json({ paper:c.req.query('paper') === 'DA' ? 'DA' : 'CS', items:priorityRows(c.req.query('paper') === 'DA' ? 'DA' : 'CS') }));
  r.get('/drills/questions', c => { const duration = c.req.query('duration_s') === '120' ? 120 : 60;
    const items = db.query(`SELECT id,topic_id,stem,difficulty FROM questions WHERE type='NAT' AND difficulty BETWEEN 2 AND 3 AND deleted_at IS NULL AND answer<>'' ORDER BY RANDOM() LIMIT ?`).all(duration === 60 ? 5 : 10);
    return c.json({ duration_s:duration, items, best:db.query('SELECT * FROM speed_drill_bests WHERE duration_s=?').get(duration) ?? null }); });
  r.post('/drills/results', async c => { const b = await c.req.json().catch(() => ({})); const duration = b.duration_s === 120 ? 120 : b.duration_s === 60 ? 60 : 0;
    if (!duration || !Array.isArray(b.answers)) return c.json({ error:{ code:'validation', message:'duration_s and answers required', details:{} } }, 422);
    // The server grades against the key; submitted client scores are ignored.
    const { grade } = await import('../../lib/grading'); let correct = 0, attempted = 0;
    for (const a of b.answers.slice(0, duration === 60 ? 5 : 10)) { const q = db.query(`SELECT * FROM questions WHERE id=? AND type='NAT' AND difficulty BETWEEN 2 AND 3`).get(a.id) as any; if (!q) continue; if (String(a.answer ?? '').trim()) attempted++; if (grade(q, a.answer)) correct++; }
    const old = db.query('SELECT best_correct FROM speed_drill_bests WHERE duration_s=?').get(duration) as any;
    if (!old || correct > old.best_correct) db.run('INSERT INTO speed_drill_bests VALUES (?,?,?,?) ON CONFLICT(duration_s) DO UPDATE SET best_correct=excluded.best_correct,best_attempted=excluded.best_attempted,achieved_at=excluded.achieved_at', [duration,correct,attempted,new Date().toISOString()]);
    return c.json({ duration_s:duration, correct, attempted, best:db.query('SELECT * FROM speed_drill_bests WHERE duration_s=?').get(duration) }); });
  return r;
}
