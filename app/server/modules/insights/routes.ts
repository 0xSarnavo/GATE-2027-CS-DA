import { Hono } from 'hono';
import type { Env } from '../../auth';
import { db } from '../../db';
import { ApiError, notFound } from '../../errors';
import { addDays, dateParam, diffDays, now, todayIST, uuid } from '../../util';
import { dueCounts, computeStreaks } from '../../lib/services';
import { priorityRows, snapshotMastery, studyNext } from '../practice/analytics';

const fail = (message: string): never => { throw new ApiError(422, 'validation', message); };
const object = async (c: any) => { const x = await c.req.json().catch(() => null); if (!x || typeof x !== 'object' || Array.isArray(x)) fail('JSON object required'); return x as Record<string,any>; };
const required = (x: any, key: string) => { if (typeof x?.[key] !== 'string' || !x[key].trim()) fail(`${key} is required`); return x[key].trim() as string; };
const oneOf = (x: any, key: string, values: string[]) => { const v = required(x,key); if (!values.includes(v)) fail(`${key} is invalid`); return v; };
const range = (c: any) => { const to = dateParam(c.req.query('to'), 'to', todayIST()); const from = dateParam(c.req.query('from'), 'from', addDays(to,-6)); if (from > to || diffDays(from,to) > 366) fail('from/to must be an ordered range of at most 366 days'); return { from,to }; };

const utc = (day:string) => new Date(Date.parse(day+'T00:00:00Z')-330*60_000).toISOString();
export function digest(from: string, to: string) {
  const tasks = db.query(`SELECT date,subject_id,status,COUNT(*) n,SUM(est_minutes) planned,SUM(done_minutes) done FROM plan_tasks WHERE date BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY date,subject_id,status`).all(from,to);
  const plan_tasks = db.query(`SELECT id,date,title,subject_id,topic_id,type,status,est_minutes,done_minutes,priority FROM plan_tasks WHERE date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date,sort`).all(from,to);
  const weeks = (db.query(`SELECT id,start_date,end_date,title,macro_goals,review_notes FROM weeks WHERE end_date>=? AND start_date<=? ORDER BY start_date`).all(from,to) as any[]).map(w=>({...w,macro_goals:JSON.parse(w.macro_goals||'[]')}));
  const minutes = db.query(`SELECT date,subject_id,SUM(minutes) minutes FROM effective_study_minutes WHERE date BETWEEN ? AND ? GROUP BY date,subject_id`).all(from,to);
  const attempts = db.query(`SELECT substr(datetime(at,'+330 minutes'),1,10) date,q.topic_id,COUNT(*) n,SUM(a.correct) correct,SUM(a.time_s) time_s,SUM(a.correct=0) wrong FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.at>=? AND a.at<? GROUP BY date,q.topic_id`).all(utc(from),utc(addDays(to,1)));
  snapshotMastery(from);
  const mastery = snapshotMastery(to).filter(x => x.attempts);
  const start = db.query(`SELECT topic_id,atom_id,score FROM concept_mastery WHERE date=?`).all(from) as any[];
  const base = new Map(start.map(x => [x.topic_id+'/'+x.atom_id,x.score]));
  const deltas = mastery.map(x => ({ topic_id:x.topic_id,atom_id:x.atom_id,score:x.score,delta:x.score-(base.get(x.topic_id+'/'+x.atom_id) ?? x.score) }));
  const mistakes = db.query(`SELECT m.id,m.question_id,q.topic_id,m.error_type,m.takeaway,m.due_on,m.status,m.created_at FROM mistakes m JOIN questions q ON q.id=m.question_id WHERE m.created_at>=? AND m.created_at<? OR (m.status='open' AND m.due_on<=?)`).all(utc(from),utc(addDays(to,1)),to);
  const doubts = db.query(`SELECT id,ref_type,ref_id,note,status,answer_md,created_at FROM doubts WHERE status='open' OR (created_at>=? AND created_at<?)`).all(utc(from),utc(addDays(to,1)));
  const mocks = db.query(`SELECT id,date,paper,raw_score,max_score,accuracy_percent FROM mocks WHERE date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date`).all(from,to);
  const sessions = db.query(`SELECT id,kind,started_at,score,max_score FROM test_sessions WHERE started_at>=? AND started_at<? AND submitted_at IS NOT NULL ORDER BY started_at`).all(utc(from),utc(addDays(to,1)));
  const checkins = db.query(`SELECT date,sleep_hours,energy,mood,revision_done FROM checkins WHERE date BETWEEN ? AND ?`).all(from,to);
  const revisions = db.query(`SELECT id,at,actor,reason FROM plan_revisions WHERE at>=? AND at<?`).all(utc(from),utc(addDays(to,1)));
  const reports = db.query(`SELECT id,kind,period_start,period_end,title FROM reports WHERE period_end>=? AND period_start<=? ORDER BY created_at DESC`).all(from,to);
  const settings = Object.fromEntries((db.query(`SELECT key,value FROM settings WHERE key IN ('exam_date','score_target','weekday_study_minutes','weekend_study_minutes')`).all() as any[]).map(x=>[x.key,x.value]));
  return { from,to,settings,due:dueCounts(to),streaks:computeStreaks(to),tasks,plan_tasks,weeks,minutes,attempts,mastery:deltas,mistakes,doubts,mocks,sessions,checkins,revisions,reports,study_next:studyNext(to),priority:{ CS:priorityRows('CS').slice(0,5), DA:priorityRows('DA').slice(0,5) } };
}
export function insightsRoutes() {
  const r = new Hono<Env>();
  r.get('/digest', c => { const {from,to} = range(c); return c.json(digest(from,to)); });
  r.get('/reports', c => { const limit = Math.min(1000,Math.max(1,Number(c.req.query('limit'))||100)); const offset=Math.max(0,Number(c.req.query('cursor'))||0); const rows = db.query('SELECT * FROM reports ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit+1,offset) as any[]; const unread=(db.query('SELECT COUNT(*) n FROM reports WHERE read_at IS NULL').get() as any).n; return c.json({ items:rows.slice(0,limit), next:rows.length>limit?String(offset+limit):null, unread }); });
  r.post('/reports', async c => { const b=await object(c), kind=oneOf(b,'kind',['daily','weekly','monthly']); const start=dateParam(b.period_start,'period_start'), end=dateParam(b.period_end,'period_end'); if(start>end) fail('period_start must be before period_end'); const id=uuid();
    db.run('INSERT INTO reports(id,kind,period_start,period_end,title,body_md,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)',[id,kind,start,end,required(b,'title'),required(b,'body_md'),c.get('actor'),now()]); return c.json(db.query('SELECT * FROM reports WHERE id=?').get(id),201); });
  r.patch('/reports/:id', async c => { const b=await object(c); if(typeof b.read !== 'boolean') fail('read must be boolean'); const id=c.req.param('id'); if(!db.query('SELECT 1 FROM reports WHERE id=?').get(id)) throw notFound('report'); db.run('UPDATE reports SET read_at=? WHERE id=?',[b.read?now():null,id]); return c.json(db.query('SELECT * FROM reports WHERE id=?').get(id)); });
  r.get('/doubts', c => { const status=c.req.query('status'); if(status && !['open','answered','all'].includes(status)) fail('invalid status'); const limit=Math.min(1000,Math.max(1,Number(c.req.query('limit'))||100)),offset=Math.max(0,Number(c.req.query('cursor'))||0); const rows=db.query(`SELECT * FROM doubts ${status && status !== 'all' ? 'WHERE status=?' : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...(status && status !== 'all'?[status]:[]),limit+1,offset) as any[]; return c.json({items:rows.slice(0,limit),next:rows.length>limit?String(offset+limit):null,unread:(db.query(`SELECT COUNT(*) n FROM doubts WHERE status='answered' AND read_at IS NULL`).get() as any).n}); });
  r.post('/doubts', async c => { const b=await object(c), type=oneOf(b,'ref_type',['question','concept','chapter']), ref=required(b,'ref_id'), note=required(b,'note'); if(note.length>4000) fail('note is too long'); const exists= type==='question' ? db.query('SELECT 1 FROM questions WHERE id=?').get(ref) : db.query('SELECT 1 FROM topics WHERE id=?').get(type==='concept'?ref.split('/')[0]:ref); if(!exists) fail('reference does not exist');
    if(type==='concept') {const [topic,atom]=ref.split('/');const row=db.query('SELECT atoms FROM topic_notes WHERE topic_id=?').get(topic) as any;let atoms:any[]=[];try{atoms=JSON.parse(row?.atoms||'[]')}catch{}if(!atom||!atoms.some(x=>x.id===atom)) fail('concept does not exist');} const id=uuid(), t=now(); db.run('INSERT INTO doubts(id,ref_type,ref_id,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[id,type,ref,note,c.get('actor'),t,t]); return c.json(db.query('SELECT * FROM doubts WHERE id=?').get(id),201); });
  r.patch('/doubts/:id', async c => { const b=await object(c), id=c.req.param('id'); const old=db.query('SELECT * FROM doubts WHERE id=?').get(id) as any; if(!old) throw notFound('doubt'); let note=old.note, answer=old.answer_md, status=old.status, read=old.read_at;
    if('note' in b) { note=required(b,'note'); if(note.length>4000) fail('note is too long'); } if('answer_md' in b) { answer=b.answer_md===null?null:required(b,'answer_md'); status=answer?'answered':'open'; read=null; }
    if('status' in b) status=oneOf(b,'status',['open','answered']); if(status==='answered'&&!answer) fail('answer_md required to answer'); if('read' in b) { if(typeof b.read!=='boolean') fail('read must be boolean'); read=b.read?now():null; }
    db.run('UPDATE doubts SET note=?,answer_md=?,status=?,answered_at=?,read_at=?,updated_at=? WHERE id=?',[note,answer,status,status==='answered'?(old.answered_at||now()):null,read,now(),id]); return c.json(db.query('SELECT * FROM doubts WHERE id=?').get(id)); });
  return r;
}
