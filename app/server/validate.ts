import { ApiError } from "./errors";

export type Field =
  | { t: "str"; req?: boolean; enum?: readonly string[]; nullable?: boolean; max?: number }
  | { t: "int"; req?: boolean; min?: number; max?: number; nullable?: boolean }
  | { t: "num"; req?: boolean; min?: number; max?: number; nullable?: boolean }
  | { t: "bool"; req?: boolean }
  | { t: "json"; req?: boolean; nullable?: boolean }
  | { t: "date"; req?: boolean; nullable?: boolean };
export type Schema = Record<string, Field>;

/** Validate + coerce body against schema. partial=true skips required checks (PATCH). Unknown keys ignored. */
export function parse(body: any, schema: Schema, partial = false): Record<string, any> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ApiError(422, "validation", "body must be a JSON object");
  const out: Record<string, any> = {};
  const errs: Record<string, string> = {};
  for (const [k, f] of Object.entries(schema)) {
    let v = body[k];
    if (v === undefined) { if (f.req && !partial) errs[k] = "required"; continue; }
    if (v === null) {
      if ("nullable" in f && f.nullable) { out[k] = null; continue; }
      if (!f.req) { out[k] = null; continue; }
      errs[k] = "must not be null"; continue;
    }
    switch (f.t) {
      case "str":
        if (typeof v === "number") v = String(v);
        if (typeof v !== "string") { errs[k] = "must be a string"; break; }
        if (f.enum && !f.enum.includes(v)) { errs[k] = `must be one of ${f.enum.join("|")}`; break; }
        if (f.max && v.length > f.max) { errs[k] = `max length ${f.max}`; break; }
        if (f.req && v === "" ) { errs[k] = "must not be empty"; break; }
        out[k] = v; break;
      case "int": case "num": {
        if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) v = Number(v);
        if (typeof v === "boolean") v = v ? 1 : 0;
        if (typeof v !== "number" || !isFinite(v) || (f.t === "int" && !Number.isInteger(v))) { errs[k] = f.t === "int" ? "must be an integer" : "must be a number"; break; }
        if (f.min !== undefined && v < f.min) { errs[k] = `min ${f.min}`; break; }
        if (f.max !== undefined && v > f.max) { errs[k] = `max ${f.max}`; break; }
        out[k] = v; break;
      }
      case "bool":
        if (v === true || v === 1 || v === "1" || v === "true") out[k] = 1;
        else if (v === false || v === 0 || v === "0" || v === "false") out[k] = 0;
        else errs[k] = "must be a boolean";
        break;
      case "json": out[k] = v; break;
      case "date":
        if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) errs[k] = "must be YYYY-MM-DD"; else out[k] = v;
        break;
    }
  }
  if (Object.keys(errs).length) throw new ApiError(422, "validation", "invalid fields: " + Object.keys(errs).join(", "), errs);
  return out;
}

export async function readJson(c: { req: { json: () => Promise<any> } }): Promise<any> {
  try { return await c.req.json(); } catch { throw new ApiError(400, "bad_json", "request body is not valid JSON"); }
}

export function insertSql(table: string, row: Record<string, any>) {
  const cols = Object.keys(row);
  return { sql: `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, params: cols.map(c => bind(row[c])) };
}
export function updateSql(table: string, row: Record<string, any>, where: string) {
  const cols = Object.keys(row);
  return { sql: `UPDATE ${table} SET ${cols.map(c => `${c}=?`).join(",")} WHERE ${where}`, params: cols.map(c => bind(row[c])) };
}
export function bind(v: any) { return v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v; }
