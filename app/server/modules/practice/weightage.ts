import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../../auth";
import { config } from "../../config";

export type Weightage = Record<"CS" | "DA", { n_papers: number; subjects: Record<string, number>; chapters: Record<string, { avg_marks: number; questions: number; years: number }> } | undefined>;
/** Past-paper weightage from CONTENT_DIR/weightage.json (average marks per paper). Empty object when the file is absent. */
export function readWeightage(): Partial<Weightage> {
  const f = join(config.contentDir, "weightage.json");
  if (!existsSync(f)) return {};
  try { const j = JSON.parse(readFileSync(f, "utf8")); return { CS: j.CS, DA: j.DA }; } catch { return {}; }
}
export function weightageRoutes() {
  const r = new Hono<Env>();
  r.get("/weightage", (c) => {
    const w = readWeightage();
    const slim = (p: any) => p && { n_papers: p.n_papers, subjects: p.subjects ?? {}, chapters: Object.fromEntries(Object.entries(p.chapters ?? {}).map(([k, v]: [string, any]) => [k, { avg_marks: v.avg_marks, questions: v.questions, years: v.years }])) };
    return c.json({ CS: slim(w.CS) ?? null, DA: slim(w.DA) ?? null });
  });
  return r;
}
