import { Hono } from 'hono';
import type { Env } from '../../auth';
import { db } from '../../db';
import { notFound } from '../../errors';

export function strategy(id: string) {
  const session = db.query(`SELECT id,kind,submitted_at FROM test_sessions WHERE id=?`).get(id) as any;
  if (!session) throw notFound('test');
  if (!session.submitted_at) return null;
  const rows = db.query(`SELECT a.pos,a.question_id,a.time_s,a.correct,a.marks_awarded,q.marks,q.type,q.topic_id,att.error_type
    FROM test_answers a JOIN questions q ON q.id=a.question_id LEFT JOIN attempts att ON att.id=a.attempt_id WHERE a.session_id=? ORDER BY a.pos`).all(id) as any[];
  const timed = rows.map(x => x.time_s).filter(x => x > 0).sort((a,b) => a-b);
  const median = timed.length ? timed[Math.floor((timed.length-1)/2)] : 0;
  const section = (x:any) => x.topic_id === 'ga' || x.topic_id.startsWith('ga.') ? 'GA' : x.marks === 1 ? '1-mark' : '2-mark';
  const sections = ['GA','1-mark','2-mark'].map(name => { const xs=rows.filter(x => section(x)===name); return { name, questions:xs.length, time_s:xs.reduce((n,x) => n+(x.time_s||0),0), marks:xs.reduce((n,x) => n+x.marks_awarded,0), max_marks:xs.reduce((n,x) => n+x.marks,0) }; });
  const history=db.query(`SELECT a.time_s,a.marks_awarded,q.marks,q.topic_id FROM test_answers a JOIN questions q ON q.id=a.question_id JOIN test_sessions s ON s.id=a.session_id WHERE s.submitted_at IS NOT NULL AND s.kind IN ('mock','pyq')`).all() as any[];
  const baseline=history.length?history:rows;
  const ranked=['GA','1-mark','2-mark'].map(name=>{const xs=baseline.filter(x=>section(x)===name);return {name,marks:xs.reduce((n,x)=>n+x.marks_awarded,0),time_s:xs.reduce((n,x)=>n+(x.time_s||0),0)} }).sort((a,b) => (b.marks/Math.max(1,b.time_s))-(a.marks/Math.max(1,a.time_s)) || ['GA','1-mark','2-mark'].indexOf(a.name)-['GA','1-mark','2-mark'].indexOf(b.name));
  const guessed=rows.filter(x => x.error_type==='guess');
  return { session_id:id, median_time_s:median, per_question:rows.map(x => ({...x,section:section(x),time_per_mark_s:x.time_s/Math.max(1,x.marks)})),
    slowest:[...rows].sort((a,b) => (b.time_s||0)-(a.time_s||0)).slice(0,10),
    skip_candidates:rows.filter(x => x.correct===0 && median>0 && x.time_s>2*median).map(x => ({question_id:x.question_id,pos:x.pos,time_s:x.time_s})),
    negative_marks_lost:Math.round(-100*rows.filter(x => x.marks_awarded<0).reduce((n,x) => n+x.marks_awarded,0))/100,
    guess_accuracy:guessed.length ? guessed.filter(x => x.correct).length/guessed.length : null, guesses:guessed.length,
    suggested_attempt_order:ranked.map(x => x.name), sections };
}
export function strategyRoutes() { const r=new Hono<Env>(); r.get('/strategy/:id', c => c.json(strategy(c.req.param('id')))); return r; }
