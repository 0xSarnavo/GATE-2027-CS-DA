import { Hono } from "hono";
import type { Env } from "../../auth";
import { db } from "../../db";
import { ApiError, notFound, validation } from "../../errors";
import { readJson } from "../../validate";
import { hydrate, istDate, now, todayIST, uuid } from "../../util";
import { grade } from "../../lib/grading";
import { createAttempt } from "../../lib/services";
import { readWeightage } from "./weightage";

/** Timed tests: quick (5/10/15/20, or task preset 5..65), topic sets (10), PYQ papers and full mocks.
 *  Answers are never sent before submit; GATE marking is applied on the server. */

// Approximate GATE mark weightage per subject (root topic id). GA is always 10 questions.
export const MOCK_WEIGHTS: Record<"CS" | "DA", Record<string, number>> = {
  CS: { dm: 10, ds: 6, algo: 9, toc: 7, cd: 6, coa: 8, os: 8, db: 7, net: 7, prob: 4, la: 3, calc: 3 },
  DA: { prob: 12, la: 10, calc: 6, ds: 7, algo: 7, db: 5, dm: 4, ml: 22, ai: 10, dl: 5 },
};
const KINDS = ["quick", "topic", "pyq", "mock"] as const;
const COUNTS = [5, 10, 15, 20];

const subtree = (id: string): string[] =>
  (db.query(`WITH RECURSIVE t(id) AS (SELECT id FROM topics WHERE id=? AND deleted_at IS NULL UNION ALL SELECT c.id FROM topics c JOIN t ON c.parent_id=t.id WHERE c.deleted_at IS NULL) SELECT id FROM t`).all(id) as any[]).map(x => x.id);
const rootOf = (id: string): string => {
  let cur = id;
  for (let i = 0; i < 8; i++) { const p = (db.query("SELECT parent_id FROM topics WHERE id=?").get(cur) as any)?.parent_id; if (!p) break; cur = p; }
  return cur;
};
const shuffle = <T,>(a: T[]): T[] => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j]!, b[i]!]; } return b; };

/** Chapters (leaf-ish topics) where recent accuracy is low. Used for "mixed weak areas" and the results screen. */
export function weakTopics(limit = 8) {
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const rows = db.query(`SELECT q.topic_id, t.name, t.parent_id, COUNT(*) attempts, SUM(a.correct) correct FROM attempts a JOIN questions q ON q.id=a.question_id JOIN topics t ON t.id=q.topic_id
    WHERE a.at>=? GROUP BY q.topic_id HAVING COUNT(*)>=3`).all(since) as any[];
  return rows.map(r => ({ topic_id: r.topic_id, name: r.name, attempts: r.attempts, accuracy: r.correct / r.attempts })).filter(r => r.accuracy < 0.6).sort((a, b) => a.accuracy - b.accuracy).slice(0, limit);
}

const BASE = "deleted_at IS NULL AND answer<>'' AND COALESCE(in_2027_syllabus,1)<>0";
function pool(topicIds: string[] | null, extra = "", params: any[] = []): any[] {
  if (topicIds && !topicIds.length) return [];
  const where = [BASE]; const p = [...params];
  if (topicIds) { where.push(`(topic_id IN (${topicIds.map(() => "?").join(",")}) OR id IN (SELECT question_id FROM question_topics WHERE topic_id IN (${topicIds.map(() => "?").join(",")})))`); p.push(...topicIds, ...topicIds); }
  if (extra) where.push(extra);
  return db.query(`SELECT * FROM questions WHERE ${where.join(" AND ")}`).all(...p) as any[];
}
/** Mix of difficulty (about 30% easy, 40% medium, 30% hard) and of sources, as far as the pool allows. */
function mix(rows: any[], n: number): any[] {
  const s = shuffle(rows);
  if (s.length <= n) return s;
  const bucket = (lo: number, hi: number) => s.filter(q => q.difficulty >= lo && q.difficulty <= hi);
  const picks: any[] = []; const used = new Set<string>();
  const take = (arr: any[], k: number) => { for (const q of arr) { if (k <= 0) break; if (used.has(q.id)) continue; used.add(q.id); picks.push(q); k--; } };
  const e = Math.round(n * 0.3), h = Math.round(n * 0.3);
  // alternate official / generated inside each bucket so sources are mixed
  const interleave = (arr: any[]) => { const o = arr.filter(q => q.source === "official"), g = arr.filter(q => q.source !== "official"); const out: any[] = []; while (o.length || g.length) { if (o.length) out.push(o.shift()); if (g.length) out.push(g.shift()); } return out; };
  take(interleave(bucket(1, 2)), e); take(interleave(bucket(4, 5)), h); take(interleave(bucket(3, 3)), n - e - h); take(interleave(s), n - picks.length);
  return shuffle(picks);
}
/** Pick n questions with about `tf` of them 2-markers (GATE papers are about 35 one-mark and 30 two-mark questions). */
function mixMarks(rows: any[], n: number, tf: number): any[] {
  const two = rows.filter(q => q.marks >= 2), one = rows.filter(q => q.marks < 2);
  let k = Math.min(Math.round(n * tf), two.length); const m = Math.min(n - k, one.length); k = Math.min(two.length, n - m);
  return [...mix(two, k), ...mix(one, m)];
}
const qNum = (q: any) => { const m = String(q.q_no ?? "").match(/\d+/); return m ? Number(m[0]) : 999; };

export const allowedSeconds = (qs: { marks: number }[]) => qs.reduce((n, q) => n + (q.marks >= 2 ? 180 : 90), 0);
/** GATE marking: correct = marks; wrong MCQ = -1/3 (1 mark) or -2/3 (2 marks); MSQ and NAT never negative; unattempted 0. */
export function marksFor(q: { type: string; marks: number; answer: string }, given: unknown): { correct: boolean | null; awarded: number } {
  const attempted = given !== null && given !== undefined && String(given).trim() !== "";
  if ((q.answer ?? "").trim().toUpperCase() === "MTA") return { correct: true, awarded: q.marks };
  if (!attempted) return { correct: null, awarded: 0 };
  const ok = grade(q, given);
  if (ok) return { correct: true, awarded: q.marks };
  return { correct: false, awarded: q.type === "MCQ" ? -(q.marks === 2 ? 2 / 3 : 1 / 3) : 0 };
}

function publicQ(q: any, index: number) {
  const h = hydrate("questions", q) as any;
  const { answer, solution, quick_method, explanation, trap_note, solution_full, quick_method_full, explanation_full, trap_note_full, answer_check, answer_check_note, hints, ...rest } = h;
  return { ...rest, answer: "", pos: index + 1 };
}

function build(kind: (typeof KINDS)[number], scope: any, count: number): { qs: any[]; short?: boolean; allowed: number } {
  if (kind === "pyq") {
    const year = Number(scope.year);
    // a paper is the full 65: include keyless questions too, they are simply unscored
    const all = db.query(`SELECT * FROM questions WHERE deleted_at IS NULL AND source='official' AND year=?${scope.paper ? " AND paper=?" : ""}${scope.session ? " AND session=?" : ""}`).all(year, ...(scope.paper ? [scope.paper] : []), ...(scope.session ? [scope.session] : [])) as any[];
    const qs = all.sort((a, b) => qNum(a) - qNum(b) || String(a.q_no).localeCompare(String(b.q_no), undefined, { numeric: true }));
    return { qs, allowed: 10800 };
  }
  if (kind === "mock") {
    const paper: "CS" | "DA" = scope.paper === "DA" ? "DA" : "CS";
    // prefer the measured average marks per paper (data/weightage.json); fall back to the built-in table
    const measured = readWeightage()[paper]?.subjects; const w = measured ? Object.fromEntries(Object.entries(measured).filter(([k]) => k !== "ga")) as Record<string, number> : MOCK_WEIGHTS[paper]; const total = Object.values(w).reduce((a, b) => a + b, 0);
    const ga = mixMarks(pool(subtree("ga")), 10, 0.5);
    const subjectN = 55;
    const roots = Object.keys(w).filter(r => db.query("SELECT 1 FROM topics WHERE id=?").get(r));
    // largest-remainder allocation
    const raw = roots.map(r => ({ r, x: (w[r]! / total) * subjectN })); const alloc = new Map(raw.map(o => [o.r, Math.floor(o.x)]));
    let left = subjectN - [...alloc.values()].reduce((a, b) => a + b, 0);
    for (const o of [...raw].sort((a, b) => (b.x % 1) - (a.x % 1))) { if (left <= 0) break; alloc.set(o.r, alloc.get(o.r)! + 1); left--; }
    const picked: any[] = []; const spill: any[] = [];
    for (const r of roots) { const p = mixMarks(pool(subtree(r)), alloc.get(r)!, 30 / 55); picked.push(...p); const got = new Set(p.map(x => x.id)); spill.push(...pool(subtree(r)).filter(x => !got.has(x.id))); }
    // top up from other subjects if a subject lacked questions
    let need = subjectN - picked.length;
    if (need > 0) { const have = new Set(picked.map(x => x.id)); picked.push(...shuffle(spill.filter(x => !have.has(x.id))).slice(0, need)); }
    const qs = [...ga, ...picked];
    return { qs, short: qs.length < 65, allowed: 10800 };
  }
  const n = kind === "topic" ? 10 : count;
  let rows: any[];
  if (scope.retake_of) {
    const prev = db.query("SELECT question_ids FROM test_sessions WHERE id=?").get(scope.retake_of) as any;
    if (!prev) throw notFound("test");
    const wrong = (db.query("SELECT question_id FROM test_answers WHERE session_id=? AND (correct=0 OR correct IS NULL)").all(scope.retake_of) as any[]).map(x => x.question_id);
    rows = wrong.map(id => db.query("SELECT * FROM questions WHERE id=? AND deleted_at IS NULL").get(id) as any).filter(Boolean);
    return { qs: shuffle(rows), allowed: allowedSeconds(rows) };
  }
  if (scope.topic_id) {
    if (!db.query("SELECT 1 FROM topics WHERE id=? AND deleted_at IS NULL").get(scope.topic_id)) throw notFound("topic");
    rows = pool(subtree(scope.topic_id), scope.atom ? "atoms LIKE ?" : "", scope.atom ? [`%"${String(scope.atom).replace(/[%_"]/g, "")}"%`] : []);
  } else if (scope.weak) {
    const ids = weakTopics(6).flatMap(w => subtree(w.topic_id));
    rows = ids.length ? pool(ids) : pool(null);
  } else if (scope.subject) {
    rows = pool(subtree(scope.subject));
  } else rows = pool(null);
  const qs = scope.easy_to_hard ? rows.sort((a, b) => a.difficulty - b.difficulty || (a.order_in_topic ?? 0) - (b.order_in_topic ?? 0)).slice(0, n) : mix(rows, n);
  return { qs, short: qs.length < n, allowed: allowedSeconds(qs) };
}

export function testRoutes() {
  const r = new Hono<Env>();

  r.get("/tests/papers", (c) => {
    const rows = db.query(`SELECT year, paper, COALESCE(session, paper) AS session, COUNT(*) n FROM questions WHERE deleted_at IS NULL AND source='official' AND year IS NOT NULL AND paper IN ('CS','DA') GROUP BY year, paper, COALESCE(session, paper) HAVING n>=20 ORDER BY year DESC, paper, session`).all();
    return c.json({ items: rows });
  });
  r.get("/tests/weak", (c) => c.json({ items: weakTopics(Math.min(20, Number(c.req.query("limit")) || 8)) }));
  r.get("/tests", (c) => {
    const rows = db.query("SELECT id,kind,scope,started_at,submitted_at,allowed_s,duration_s,score,max_score,mock_id FROM test_sessions ORDER BY started_at DESC LIMIT ?").all(Math.min(200, Number(c.req.query("limit")) || 30)) as any[];
    return c.json({ items: rows.map(x => ({ ...x, scope: JSON.parse(x.scope) })) });
  });

  r.post("/tests", async (c) => {
    const b = await readJson(c);
    const kind = b?.kind; if (!KINDS.includes(kind)) throw validation(`kind must be one of ${KINDS.join(", ")}`);
    const scope = b.scope && typeof b.scope === "object" ? b.scope : {};
    const count = b.count === undefined ? 10 : Number(b.count);
    if (kind === "quick" && !COUNTS.includes(count) && !(scope.task_preset === true && Number.isInteger(count) && count >= 5 && count <= 65)) throw validation("count must be 5, 10, 15 or 20");
    if (kind === "pyq" && !Number.isInteger(Number(scope.year))) throw validation("scope.year is required for a PYQ paper");
    if (kind === "topic" && !scope.topic_id && !scope.retake_of) throw validation("scope.topic_id is required for a topic set");
    const { qs, short, allowed } = build(kind, scope, count);
    if (!qs.length) throw new ApiError(422, "validation", "no questions match this scope");
    const id = uuid();
    db.run("INSERT INTO test_sessions(id,kind,scope,question_ids,question_snapshot,started_at,allowed_s,updated_at) VALUES (?,?,?,?,?,?,?,?)", [id, kind, JSON.stringify(scope), JSON.stringify(qs.map(q => q.id)), JSON.stringify(qs), now(), allowed, now()]);
    const max = qs.reduce((n, q) => n + (q.answer ? q.marks : 0), 0);
    return c.json({ id, kind, scope, allowed_s: allowed, max_score: max, short: !!short, questions: qs.map(publicQ) }, 201);
  });

  r.get("/tests/:id", (c) => {
    const s = db.query("SELECT * FROM test_sessions WHERE id=?").get(c.req.param("id")) as any;
    if (!s) throw notFound("test");
    const ids: string[] = JSON.parse(s.question_ids);
    const rows = s.question_snapshot ? JSON.parse(s.question_snapshot) as any[] : ids.map(id => db.query("SELECT * FROM questions WHERE id=?").get(id) as any).filter(Boolean);
    const done = !!s.submitted_at;
    return c.json({ id: s.id, kind: s.kind, scope: JSON.parse(s.scope), started_at: s.started_at, submitted_at: s.submitted_at, allowed_s: s.allowed_s, duration_s: s.duration_s, score: s.score, max_score: s.max_score,
      result: s.detail ? JSON.parse(s.detail) : null,
      questions: rows.map((q, i) => done ? { ...(hydrate("questions", q) as any), pos: i + 1 } : publicQ(q, i)) });
  });

  r.post("/tests/:id/submit", async (c) => {
    const s = db.query("SELECT * FROM test_sessions WHERE id=?").get(c.req.param("id")) as any;
    if (!s) throw notFound("test");
    if (s.submitted_at) throw new ApiError(409, "conflict", "this test was already submitted");
    const b = await readJson(c);
    const answers = new Map<string, any>((Array.isArray(b?.answers) ? b.answers : []).map((a: any) => [String(a.question_id), a]));
    const ids: string[] = JSON.parse(s.question_ids);
    const scope = JSON.parse(s.scope);
    const spent = Math.max(0, Math.min(Number(b?.duration_s) || 0, 86400));
    const actor = c.get("actor");
    const day = istDate();
    let mockId: string | null = null;
    const result = db.transaction(() => {
      const per: any[] = []; let score = 0, max = 0, attempted = 0, correctN = 0, attMarks = 0;
      const qrows = s.question_snapshot ? JSON.parse(s.question_snapshot) as any[] : ids.map(id => db.query("SELECT * FROM questions WHERE id=?").get(id) as any);
      // a mock is a tracked paper too (existing trend chart keeps working)
      if (s.kind === "mock" || s.kind === "pyq") {
        const paper = scope.paper === "DA" ? "DA" : "CS";
        mockId = uuid();
        db.run("INSERT INTO mocks(id,date,paper,year,session,label,max_score,duration_min,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
          [mockId, todayIST(), paper, scope.year ?? null, scope.session ?? null, s.kind === "mock" ? `Full mock ${paper}` : `PYQ ${scope.year ?? ""} ${scope.session ?? paper}`.trim(), 100, Math.round(spent / 60), now()]);
      }
      qrows.forEach((q, i) => {
        const a = answers.get(q.id); const given = a?.given_answer ?? null;
        const m = q.answer?.trim() ? marksFor(q, given) : { correct: null as boolean | null, awarded: 0 };
        if (q.answer?.trim()) max += q.marks;
        score += m.awarded;
        const did = given !== null && String(given).trim() !== "";
        let attemptId: string | null = null;
        if (did && q.answer?.trim()) {
          attempted++; attMarks += q.marks; if (m.correct) correctN++;
          const at = createAttempt({ question_id: q.id, given_answer: String(given), time_s: Number(a?.time_s) || 0, mode: "test", mock_id: mockId, at: now() }, actor, m.correct!) as any;
          attemptId = at.attempt?.id ?? null;
        }
        db.run("INSERT INTO test_answers(session_id,question_id,pos,given_answer,correct,marks_awarded,marked,time_s,attempt_id) VALUES (?,?,?,?,?,?,?,?,?)",
          [s.id, q.id, i + 1, did ? String(given) : null, m.correct === null ? null : m.correct ? 1 : 0, m.awarded, a?.marked ? 1 : 0, Number(a?.time_s) || null, attemptId]);
        per.push({ question_id: q.id, pos: i + 1, topic_id: q.topic_id, marks: q.marks, type: q.type, given_answer: did ? String(given) : null, correct: m.correct, marks_awarded: m.awarded, time_s: Number(a?.time_s) || 0, correct_answer: q.answer, marked: !!a?.marked, attempt_id: attemptId });
      });
      const nameOf = (id: string) => (db.query("SELECT name FROM topics WHERE id=?").get(id) as any)?.name ?? id;
      const group = (keyFn: (p: any) => string, label: (k: string) => string) => {
        const g = new Map<string, any>();
        for (const p of per) { const k = keyFn(p); const e = g.get(k) ?? { id: k, name: label(k), total: 0, attempted: 0, correct: 0, score: 0, max: 0 }; e.total++; e.max += p.marks; e.score += p.marks_awarded; if (p.given_answer !== null) e.attempted++; if (p.correct) e.correct++; g.set(k, e); }
        return [...g.values()].map(e => ({ ...e, score: Math.round(e.score * 100) / 100, accuracy: e.attempted ? e.correct / e.attempted : null }));
      };
      const bySubject = group(p => rootOf(p.topic_id), nameOf).sort((a, b) => b.total - a.total);
      const byChapter = group(p => p.topic_id, nameOf);
      // weak = chapter where something was wrong or skipped: lowest accuracy over questions in the test, most marks lost first
      const weak = byChapter.filter(x => x.correct < x.total).map(x => ({ ...x, lost: x.max - x.score, subject_id: rootOf(x.id) })).sort((a, b) => b.lost - a.lost).slice(0, 5);
      const detail = { score: Math.round(score * 100) / 100, max_score: max, attempted, correct: correctN, wrong: attempted - correctN, unattempted: ids.length - attempted, accuracy: attempted ? correctN / attempted : 0, duration_s: spent, allowed_s: s.allowed_s,
        by_subject: bySubject, by_chapter: byChapter, weak, per_question: per };
      db.run("UPDATE test_sessions SET submitted_at=?, duration_s=?, score=?, max_score=?, detail=?, mock_id=?, updated_at=? WHERE id=?", [now(), spent, detail.score, max, JSON.stringify(detail), mockId, now(), s.id]);
      if (mockId) db.run("UPDATE mocks SET max_score=?, raw_score=?, attempted_marks=?, accuracy_percent=?, topics_to_revise=?, notes=?, updated_at=? WHERE id=?",
        [max || 100, detail.score, attMarks, Math.round(detail.accuracy * 1000) / 10, JSON.stringify(weak.slice(0, 3).map(w => w.name)), `Auto-recorded from test ${s.id}. Date ${day}.`, now(), mockId]);
      return { id: s.id, kind: s.kind, mock_id: mockId, ...detail };
    })();
    return c.json(result);
  });
  return r;
}
