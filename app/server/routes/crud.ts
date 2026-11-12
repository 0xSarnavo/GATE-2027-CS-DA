import { Hono } from "hono";
import { db } from "../db";
import type { Env } from "../auth";
import { notFound, ApiError } from "../errors";
import { parse, readJson, insertSql, updateSql, type Schema } from "../validate";
import { dehydrate, hydrate, now, page, paging, uuid } from "../util";
import { createdBy } from "../lib/services";

export interface Entity {
  table: string; path: string; schema: Schema;
  /** key in POST body for bulk create, e.g. "videos" */
  bulkKey?: string;
  createdBy?: boolean;
  /** extra WHERE filters from query: name -> sql (single ? param) */
  filters?: Record<string, string>;
  order?: string;
  /** required id on create (e.g. topics use slugs); default uuid */
  idRequired?: boolean;
  /** extra defaults on create */
  defaults?: Record<string, any>;
}

/** Generic CRUD for simple soft-deleted tables (videos, jobs, mocks, topics, cards ...). */
export function crud(e: Entity) {
  const r = new Hono<Env>();
  const get = (id: string) => {
    const row = db.query(`SELECT * FROM ${e.table} WHERE id=? AND deleted_at IS NULL`).get(id);
    if (!row) throw notFound(e.table);
    return hydrate(e.table, row as any)!;
  };
  const create = (raw: any, actor: any) => {
    const p = dehydrate(e.table, parse(raw, e.schema));
    const id = raw.id ?? uuid();
    if (e.idRequired && !raw.id) throw new ApiError(422, "validation", "id is required", { id: "required" });
    const row: any = { ...(e.defaults ?? {}), ...p, id, updated_at: now() };
    if (db.query(`SELECT 1 FROM pragma_table_info('${e.table}') WHERE name='created_at'`).get()) row.created_at = now();
    if (e.createdBy !== false) row.created_by = createdBy(actor);
    const i = insertSql(e.table, row); db.run(i.sql, i.params);
    return id;
  };

  r.get(e.path, (c) => {
    const { limit, offset } = paging(k => c.req.query(k));
    const where = [`deleted_at IS NULL`]; const params: any[] = [];
    for (const [k, sql] of Object.entries(e.filters ?? {})) { const v = c.req.query(k); if (v !== undefined && v !== "") { where.push(sql); params.push(v); } }
    const rows = db.query(`SELECT * FROM ${e.table} WHERE ${where.join(" AND ")} ORDER BY ${e.order ?? "id"} LIMIT ? OFFSET ?`).all(...params, limit + 1, offset) as any[];
    const pg = page(rows, limit, offset);
    return c.json({ ...pg, items: pg.items.map(x => hydrate(e.table, x)) });
  });
  r.get(`${e.path}/:id`, (c) => c.json(get(c.req.param("id"))));
  r.post(e.path, async (c) => {
    const body = await readJson(c);
    if (e.bulkKey && Array.isArray(body?.[e.bulkKey])) {
      const list = body[e.bulkKey]; if (list.length > 500) throw new ApiError(422, "validation", "max 500 per request");
      const ids = db.transaction(() => list.map((x: any) => create(x, c.get("actor"))))();
      return c.json({ [e.bulkKey]: ids.map(get) }, 201);
    }
    return c.json(get(db.transaction(() => create(body, c.get("actor")))()), 201);
  });
  r.patch(`${e.path}/:id`, async (c) => {
    const id = c.req.param("id"); get(id);
    const p = dehydrate(e.table, parse(await readJson(c), e.schema, true));
    if (Object.keys(p).length) { const u = updateSql(e.table, { ...p, updated_at: now() }, "id=?"); db.run(u.sql, [...u.params, id]); }
    return c.json(get(id));
  });
  r.delete(`${e.path}/:id`, (c) => {
    const id = c.req.param("id"); get(id);
    db.run(`UPDATE ${e.table} SET deleted_at=?, updated_at=? WHERE id=?`, [now(), now(), id]);
    return c.body(null, 204);
  });
  return r;
}
