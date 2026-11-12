import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "gate-test-lt-"));
process.env.API_TOKEN = "tok";
process.env.SESSION_SECRET = "s";
process.env.APP_PASSWORD_HASH = await Bun.password.hash("pw", { algorithm: "argon2id" });
process.env.IMPORT_ON_BOOT = "0";

const { buildApp } = await import("../app");
const { runSeed } = await import("../../seed/load");
const { db } = await import("../db");
const { marksFor, allowedSeconds } = await import("../modules/practice/tests");
const app = buildApp();
const j = async (method: string, path: string, body?: any) => {
  const r = await app.fetch(new Request("http://x" + path, { method, headers: { "content-type": "application/json", Authorization: "Bearer tok" }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: r.status, body: r.status === 204 ? null : await r.json() as any };
};
let topic = "";
beforeAll(async () => {
  runSeed();
  topic = ((await j("GET", "/api/topics")).body.items as any[]).find(t => t.parent_id)!.id;
  const qs = Array.from({ length: 14 }, (_, i) => ({ id: `t.q${i}`, source: "generated", topic_id: topic, type: i % 5 === 4 ? "NAT" : "MCQ", marks: i % 2 ? 2 : 1, stem: `Question ${i}`, options: i % 5 === 4 ? null : [{ key: "A", text: "x" }, { key: "B", text: "y" }], answer: i % 5 === 4 ? "7" : "A", difficulty: 1 + (i % 5), level: 1 + (i % 5), atoms: ["a1"] }));
  expect((await j("POST", "/api/questions", { questions: qs })).status).toBe(201);
});

describe("GATE marking", () => {
  test("MCQ negative 1/3 and 2/3, MSQ and NAT never negative, MTA gives marks to all", () => {
    expect(marksFor({ type: "MCQ", marks: 1, answer: "A" }, "A")).toEqual({ correct: true, awarded: 1 });
    expect(marksFor({ type: "MCQ", marks: 1, answer: "A" }, "B").awarded).toBeCloseTo(-1 / 3);
    expect(marksFor({ type: "MCQ", marks: 2, answer: "A" }, "B").awarded).toBeCloseTo(-2 / 3);
    expect(marksFor({ type: "MSQ", marks: 2, answer: "A,C" }, "A").awarded).toBe(0);
    expect(marksFor({ type: "NAT", marks: 2, answer: "7" }, "8").awarded).toBe(0);
    expect(marksFor({ type: "MCQ", marks: 1, answer: "A" }, "")).toEqual({ correct: null, awarded: 0 });
    expect(marksFor({ type: "MCQ", marks: 1, answer: "MTA" }, null)).toEqual({ correct: true, awarded: 1 });
    expect(allowedSeconds([{ marks: 1 }, { marks: 2 }])).toBe(270);
  });
});

describe("learn: notes, concepts, bookmarks", () => {
  test("note upsert and read", async () => {
    expect((await j("GET", `/api/topics/${topic}/note`)).body.body).toBe("");
    expect((await j("PUT", `/api/topics/${topic}/note`, { body: "remember this" })).body.body).toBe("remember this");
    expect((await j("GET", `/api/topics/${topic}/note`)).body.body).toBe("remember this");
    expect((await j("PUT", `/api/topics/${topic}/note`, { body: 5 })).status).toBe(422);
    expect((await j("GET", "/api/topics/nope/note")).status).toBe(404);
  });
  test("concept got it / clear", async () => {
    expect((await j("PUT", `/api/concepts/${topic}/a1`, {})).body.status).toBe("got_it");
    expect((await j("GET", `/api/concepts/progress?topic_id=${topic}`)).body.items).toHaveLength(1);
    expect((await j("PUT", `/api/concepts/${topic}/a1`, { status: "bad" })).status).toBe(422);
    expect((await j("PUT", `/api/concepts/${topic}/a1`, { status: null })).body.status).toBeNull();
    expect((await j("GET", `/api/concepts/progress?topic_id=${topic}`)).body.items).toHaveLength(0);
    await j("PUT", `/api/concepts/${topic}/a1`, {});
    await j("DELETE", `/api/concepts/${topic}/a1`);
    expect((await j("GET", "/api/concepts/progress")).body.items).toHaveLength(0);
  });
  test("concept list is built from chapter blueprints", async () => {
    const { db } = await import("../db");
    db.run("INSERT INTO topic_notes(topic_id,atoms,updated_at) VALUES (?,?,?)", [topic, JSON.stringify([{ id: "a1", name: "Atom one", one_line: "x" }]), new Date().toISOString()]);
    const it = (await j("GET", "/api/concepts")).body.items as any[];
    expect(it.find(x => x.topic_id === topic && x.atom_id === "a1")).toMatchObject({ name: "Atom one", has_card: false });
  });
  test("bookmark add/list/remove", async () => {
    expect((await j("PUT", "/api/bookmarks/t.q1")).body.bookmarked).toBe(true);
    expect((await j("GET", "/api/bookmarks")).body.items.map((x: any) => x.question_id)).toEqual(["t.q1"]);
    expect((await j("PUT", "/api/bookmarks/missing")).status).toBe(404);
    await j("DELETE", "/api/bookmarks/t.q1");
    expect((await j("GET", "/api/bookmarks")).body.items).toHaveLength(0);
  });
});

describe("tests", () => {
  test("quick test hides answers, grades with GATE marking, records attempts + mistakes", async () => {
    expect((await j("POST", "/api/tests", { kind: "quick", count: 7 })).status).toBe(422);
    const t = await j("POST", "/api/tests", { kind: "quick", count: 10, scope: { topic_id: topic } });
    expect(t.status).toBe(201);
    expect(t.body.questions).toHaveLength(10);
    expect(t.body.questions.every((q: any) => q.answer === "" && !q.solution)).toBe(true);
    expect(t.body.allowed_s).toBeGreaterThan(0);
    const qs = t.body.questions as any[];
    const right = qs.find(q => q.type === "MCQ" && q.marks === 1) ?? qs[0];
    const wrongQ = qs.find(q => q.type === "MCQ" && q.id !== right.id)!;
    const sub = await j("POST", `/api/tests/${t.body.id}/submit`, { duration_s: 120, answers: [
      { question_id: right.id, given_answer: "A", time_s: 30 }, { question_id: wrongQ.id, given_answer: "B", time_s: 20, marked: true }] });
    expect(sub.status).toBe(200);
    expect(sub.body.attempted).toBe(2); expect(sub.body.correct).toBe(1); expect(sub.body.unattempted).toBe(8);
    expect(sub.body.score).toBeCloseTo(right.marks - (wrongQ.marks === 2 ? 2 / 3 : 1 / 3));
    expect(sub.body.weak.length).toBeGreaterThan(0);
    expect((await j("POST", `/api/tests/${t.body.id}/submit`, { answers: [] })).status).toBe(409);
    const att = (await j("GET", `/api/attempts?question_id=${wrongQ.id}`)).body.items;
    expect(att[0].mode).toBe("test");
    expect(((await j("GET", "/api/mistakes")).body.items as any[]).some(m => m.question_id === wrongQ.id)).toBe(true);
    const got = (await j("GET", `/api/tests/${t.body.id}`)).body;
    expect(got.questions[0].answer).not.toBe(""); expect(got.result.attempted).toBe(2);
    const retake = await j("POST", "/api/tests", { kind: "topic", scope: { retake_of: t.body.id } });
    expect(retake.body.questions.length).toBeGreaterThan(0);
  });
  test("an open test keeps its original key when content changes", async () => {
    const t = await j("POST", "/api/tests", { kind: "quick", count: 5, scope: { topic_id: topic } });
    const q = t.body.questions.find((x: any) => x.type === "MCQ");
    const original = (db.query("SELECT answer FROM questions WHERE id=?").get(q.id) as any).answer;
    db.run("UPDATE questions SET answer=? WHERE id=?", [original === "A" ? "B" : "A", q.id]);
    try {
      const result = await j("POST", `/api/tests/${t.body.id}/submit`, { answers: [{ question_id: q.id, given_answer: original }] });
      expect(result.body.per_question.find((x: any) => x.question_id === q.id)).toMatchObject({ correct: true, correct_answer: original });
      expect((db.query("SELECT correct FROM attempts WHERE id=?").get(result.body.per_question.find((x: any) => x.question_id === q.id).attempt_id) as any).correct).toBe(1);
      expect((await j("GET", `/api/tests/${t.body.id}`)).body.questions.find((x: any) => x.id === q.id).answer).toBe(original);
    } finally { db.run("UPDATE questions SET answer=? WHERE id=?", [original, q.id]); }
  });
  test("full mock samples 65 where the pool allows and creates a mocks row", async () => {
    const t = await j("POST", "/api/tests", { kind: "mock", scope: { paper: "CS" } });
    expect(t.status).toBe(201);
    expect(t.body.allowed_s).toBe(10800);
    const sub = await j("POST", `/api/tests/${t.body.id}/submit`, { duration_s: 60, answers: [] });
    expect(sub.body.mock_id).toBeTruthy();
    expect((await j("GET", "/api/mocks")).body.items.some((m: any) => m.id === sub.body.mock_id)).toBe(true);
  });
  test("pyq paper keeps original order", async () => {
    const qs = [3, 1, 2].map(n => ({ id: `p.${n}`, source: "official", paper: "CS", year: 2031, session: "CS1", q_no: String(n), topic_id: topic, type: "MCQ", marks: 1, stem: "s" + n, options: [{ key: "A", text: "x" }], answer: "A", difficulty: 2 }));
    await j("POST", "/api/questions", { questions: qs });
    const t = await j("POST", "/api/tests", { kind: "pyq", scope: { year: 2031, paper: "CS", session: "CS1" } });
    expect(t.body.questions.map((q: any) => q.q_no)).toEqual(["1", "2", "3"]);
    expect((await j("POST", "/api/tests", { kind: "pyq", scope: {} })).status).toBe(422);
  });
});

test("weightage endpoint is read-only and never fails when the file is missing", async () => {
  const r = await j("GET", "/api/weightage");
  expect(r.status).toBe(200);
  expect(Object.keys(r.body).sort()).toEqual(["CS", "DA"]);
  expect((await app.fetch(new Request("http://x/api/weightage", { method: "PUT", headers: { Authorization: "Bearer tok" } }))).status).toBeGreaterThanOrEqual(404);
});
