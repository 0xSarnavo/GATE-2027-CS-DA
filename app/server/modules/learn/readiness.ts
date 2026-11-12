import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../../auth";
import { config } from "../../config";
import { db } from "../../db";
import { notFound, validation } from "../../errors";
import { now } from "../../util";
import { readJson } from "../../validate";

type Question = { id: string; stem: string; type: "MCQ" | "NAT"; options?: (string | { key: string; text: string })[]; answer: string | number; tests: string; explain: string };
type Check = { chapter_id: string; questions: Question[] };

function checkFor(chapter: string): Check | null {
  if (!db.query("SELECT 1 FROM topics WHERE id=? AND deleted_at IS NULL").get(chapter)) throw notFound("topic");
  if (!/^[a-z0-9_.]+$/.test(chapter)) throw validation("invalid chapter id");
  const path = join(config.contentDir, "readiness", `${chapter}.json`);
  if (!existsSync(path)) return null;
  const file = JSON.parse(readFileSync(path, "utf8")) as Check;
  const prereqs = new Set((db.query("SELECT prereq_id FROM topic_prereqs WHERE topic_id=?").all(chapter) as { prereq_id: string }[]).map(x => x.prereq_id));
  if (file.chapter_id !== chapter || !Array.isArray(file.questions) || !file.questions.length ||
      file.questions.some(q => !q.id || !q.stem || !["MCQ", "NAT"].includes(q.type) || !prereqs.has(q.tests) ||
        (q.type === "MCQ" && (!Array.isArray(q.options) || !q.options.length || !q.options.some((o, i) => (typeof o === "string" ? String.fromCharCode(65 + i) : o.key) === q.answer))) ||
        (q.type === "NAT" && !Number.isFinite(Number(q.answer)))))
    throw new Error(`Invalid readiness content: ${chapter}`);
  return file;
}

export function readinessRoutes() {
  const r = new Hono<Env>();
  r.get("/readiness/:chapter", c => {
    const chapter = c.req.param("chapter"), check = checkFor(chapter);
    const row = db.query("SELECT result_json, submitted_at FROM readiness_results WHERE chapter_id=?").get(chapter) as { result_json: string; submitted_at: string } | null;
    return c.json({ chapter_id: chapter, available: !!check,
      questions: check?.questions.map(({ answer, explain, ...q }) => q) ?? [],
      latest: row ? { ...JSON.parse(row.result_json), submitted_at: row.submitted_at } : null });
  });
  r.post("/readiness/:chapter/submit", async c => {
    const chapter = c.req.param("chapter"), check = checkFor(chapter);
    if (!check) throw notFound("readiness check");
    const body = await readJson(c);
    if (!body || typeof body.answers !== "object" || Array.isArray(body.answers) || body.answers === null) throw validation("answers must be an object keyed by question id");
    const ids = new Set(check.questions.map(q => q.id));
    if (Object.keys(body.answers).some(id => !ids.has(id))) throw validation("unknown question id");
    const results = check.questions.map(q => {
      const given = String(body.answers[q.id] ?? "").trim();
      const correct = q.type === "NAT" ? given !== "" && Number.isFinite(Number(given)) && Math.abs(Number(given) - Number(q.answer)) < 1e-9 : given.toUpperCase() === String(q.answer).toUpperCase();
      return { id: q.id, tests: q.tests, correct, given, answer: q.answer, explain: q.explain };
    });
    const prerequisites = [...new Set(check.questions.map(q => q.tests))].map(id => {
      const tested = results.filter(r => r.tests === id);
      return { id, correct: tested.filter(r => r.correct).length, total: tested.length, ready: tested.every(r => r.correct) };
    });
    const result = { chapter_id: chapter, correct: results.filter(r => r.correct).length, total: results.length, prerequisites, questions: results };
    const submitted_at = now();
    db.run("INSERT INTO readiness_results(chapter_id,result_json,submitted_at) VALUES (?,?,?) ON CONFLICT(chapter_id) DO UPDATE SET result_json=excluded.result_json,submitted_at=excluded.submitted_at", [chapter, JSON.stringify(result), submitted_at]);
    return c.json({ ...result, submitted_at });
  });
  return r;
}
