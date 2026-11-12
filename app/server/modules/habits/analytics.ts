import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../../auth';
import { config } from '../../config';
import { db } from '../../db';
import { addDays, dateParam, diffDays, todayIST } from '../../util';
import { snapshotMastery } from '../practice/analytics';

export function cutoffPoints(raw:any): {paper:string;year:number;score:number;category:string}[] {
  const out:{paper:string;year:number;score:number;category:string}[]=[];
  const add=(paper:string,year:any,value:any,category='general')=>{const score=Number(value);if(['CS','DA'].includes(paper)&&Number.isInteger(Number(year))&&score>0&&score<=100)out.push({paper,year:Number(year),score,category})};
  const root=raw?.qualifying_cutoffs??raw?.qualifying??raw?.cutoffs??raw;
  for(const paper of ['CS','DA']) { const block=root?.[paper]??root?.[paper.toLowerCase()];
    if(Array.isArray(block)) for(const x of block) add(paper,x.year,x.general??x.GEN??x.cutoff??x.score);
    else if(block&&typeof block==='object') for(const [year,x] of Object.entries(block)) add(paper,year,typeof x==='object'&&x!==null?(x as any).general??(x as any).GEN??(x as any).cutoff??(x as any).score:x);
  }
  if(Array.isArray(root)) for(const x of root) add(String(x.paper??x.subject??''),x.year,x.general??x.GEN??x.cutoff??x.score);
  else if(root&&typeof root==='object') for(const [year,byPaper] of Object.entries(root)) if(/^20\d\d$/.test(year)&&byPaper&&typeof byPaper==='object') for(const paper of ['CS','DA']) {const x=(byPaper as any)[paper];if(x) add(paper,year,typeof x==='object'?x.general??x.GEN??x.cutoff??x.score:x);}
  return out.sort((a,b)=>a.paper.localeCompare(b.paper)||a.year-b.year);
}
const utc=(day:string)=>new Date(Date.parse(day+'T00:00:00Z')-330*60_000).toISOString();
export function habitsAnalyticsRoutes() {
  const r=new Hono<Env>();
  r.get('/analytics/period', c => { const to=dateParam(c.req.query('to'),'to',todayIST()), from=dateParam(c.req.query('from'),'from',addDays(to,c.req.query('period')==='monthly'?-29:-6)); if(from>to||diffDays(from,to)>366) return c.json({error:{code:'validation',message:'invalid range',details:{}}},422);
    const hours=db.query(`SELECT subject_id,SUM(est_minutes) planned_min,SUM(done_minutes) done_min FROM plan_tasks WHERE date BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY subject_id`).all(from,to);
    const actual=db.query(`SELECT subject_id,SUM(minutes) done_min FROM effective_study_minutes WHERE date BETWEEN ? AND ? GROUP BY subject_id`).all(from,to) as any[];
    const bySubject=new Map(actual.map(x=>[x.subject_id,x.done_min]));
    for(const h of hours as any[]) h.done_min=bySubject.get(h.subject_id)??0;
    for(const x of actual) if(!(hours as any[]).some(h=>h.subject_id===x.subject_id)) (hours as any[]).push({subject_id:x.subject_id,planned_min:0,done_min:x.done_min});
    const accuracy=db.query(`SELECT substr(datetime(at,'+330 minutes'),1,10) date,COUNT(*) attempted,SUM(correct) correct FROM attempts WHERE at>=? AND at<? GROUP BY date ORDER BY date`).all(utc(from),utc(addDays(to,1)));
    const adherence=db.query(`SELECT COUNT(*) planned,SUM(status='done') done FROM plan_tasks WHERE date BETWEEN ? AND ? AND deleted_at IS NULL AND fixed=0`).get(from,to) as any;
    const chapters=db.query(`SELECT q.topic_id,t.name,COUNT(*) attempts,SUM(a.correct) correct FROM attempts a JOIN questions q ON q.id=a.question_id JOIN topics t ON t.id=q.topic_id WHERE a.at>=? AND a.at<? GROUP BY q.topic_id HAVING attempts>0 ORDER BY 1`).all(utc(from),utc(addDays(to,1))) as any[];
    snapshotMastery(from); snapshotMastery(to);
    const mastery=db.query(`SELECT e.topic_id,e.atom_id,e.score-COALESCE(s.score,e.score) gained FROM concept_mastery e LEFT JOIN concept_mastery s ON s.topic_id=e.topic_id AND s.atom_id=e.atom_id AND s.date=? WHERE e.date=?`).all(from,to);
    const streakMin=Number((db.query("SELECT value FROM settings WHERE key='streak_study_min'").get() as any)?.value)||60;
    const studyDays=(db.query(`SELECT COUNT(*) n FROM (SELECT date FROM effective_study_minutes WHERE date BETWEEN ? AND ? GROUP BY date HAVING SUM(minutes)>=?)`).get(from,to,streakMin) as any).n;
    const ordered=chapters.map(x => ({...x,accuracy:x.correct/x.attempts})).sort((a,b) => b.accuracy-a.accuracy);
    return c.json({from,to,hours,accuracy,mastery,study_days:studyDays,plan_adherence:adherence.planned?adherence.done/adherence.planned:0,best_chapters:ordered.slice(0,5),worst_chapters:ordered.slice(-5).reverse()}); });
  r.get('/analytics/energy', c => { const rows=db.query(`SELECT substr(datetime(a.at,'+330 minutes'),1,10) date,CAST(strftime('%H',datetime(a.at,'+330 minutes')) AS INTEGER) hour,COUNT(*) attempts,SUM(a.correct) correct,ch.sleep_hours,ch.energy FROM attempts a LEFT JOIN checkins ch ON ch.date=substr(datetime(a.at,'+330 minutes'),1,10) GROUP BY date,hour ORDER BY date,hour`).all(); return c.json({items:rows}); });
  r.get('/analytics/scores', c => { const file=join(config.contentDir,'cutoffs.json'); let cutoffs:any=null; if(existsSync(file)) try {cutoffs=JSON.parse(readFileSync(file,'utf8'));} catch { /* empty */ }
    const mocks=db.query(`SELECT id,date,paper,raw_score,max_score,label FROM mocks WHERE deleted_at IS NULL AND raw_score IS NOT NULL ORDER BY date`).all();
    const target=Number((db.query(`SELECT value FROM settings WHERE key='score_target'`).get() as any)?.value)||null;
    return c.json({mocks,cutoffs,cutoff_points:cutoffPoints(cutoffs),target,cutoffs_label:'estimate'}); });
  return r;
}
