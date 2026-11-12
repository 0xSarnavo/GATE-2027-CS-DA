import { Hono } from "hono";
import type { Env } from "../../auth";
import type { Schema } from "../../validate";
import { crud } from "../../routes/crud";

export const MOCK: Schema = {
  date: { t: "date", req: true }, paper: { t: "str", req: true, enum: ["CS", "DA", "GA", "sectional"] }, year: { t: "int", nullable: true },
  session: { t: "str", nullable: true }, label: { t: "str", nullable: true }, raw_score: { t: "num", nullable: true }, max_score: { t: "num", nullable: true },
  attempted_marks: { t: "num", nullable: true }, accuracy_percent: { t: "num", nullable: true }, duration_min: { t: "int", nullable: true },
  unfinished: { t: "int", nullable: true }, time_issue: { t: "str", nullable: true }, topics_to_revise: { t: "json" }, notes: { t: "str", nullable: true },
};
export function mockRoutes() {
  const r = new Hono<Env>();
  r.route("/", crud({ table: "mocks", path: "/mocks", schema: MOCK, order: "date DESC, id", filters: { paper: "paper=?", from: "date>=?", to: "date<=?" } }));

  return r;
}
