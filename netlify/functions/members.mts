import type { Config, Context } from "@netlify/functions";
import { db, error, json, readBody, str, uid } from "../lib/db.mts";

export interface Member {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

const SELECT = `id, name, status, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at`;

/** GET /api/members â€” every staff member. */
async function list(): Promise<Response> {
  const rows = await db.sql<Member>`
    SELECT ${db.sql.raw(SELECT)}
      FROM members
     ORDER BY name ASC`;
  return json({ members: rows });
}

/** POST /api/members â€” add a staff member. */
async function create(req: Request): Promise<Response> {
  const body = await readBody(req);
  const name = str(body.name);
  if (!name) return error("Staff member name is required.");

  // Upsert on id when supplied, otherwise on name â€” a device re-syncing its
  // local members must not create duplicates.
  const id = str(body.id);
  const rows = id
    ? await db.sql<Member>`
        INSERT INTO members (id, name, status)
        VALUES (${id}, ${name}, 'active')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name, status, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at`
    : await db.sql<Member>`
        INSERT INTO members (id, name, status)
        VALUES (${uid()}, ${name}, 'active')
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name, status, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at`;

  return json({ member: rows[0] }, 201);
}

/** PATCH /api/members/:id â€” activate or deactivate a staff member. */
async function patch(req: Request, id: string): Promise<Response> {
  const body = await readBody(req);
  const status = str(body.status);

  if (status !== "active" && status !== "inactive") {
    return error("Status must be 'active' or 'inactive'.");
  }

  const rows = await db.sql<Member>`
    UPDATE members SET status = ${status}
     WHERE id = ${id}
    RETURNING id, name, status, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at`;

  if (!rows.length) return error("Staff member not found.", 404);
  return json({ member: rows[0] });
}

/** DELETE /api/members/:id */
async function remove(id: string): Promise<Response> {
  const rows = await db.sql<{ id: string }[]>`DELETE FROM members WHERE id = ${id} RETURNING id`;
  if (!rows.length) return error("Staff member not found.", 404);
  return json({ ok: true, id });
}

export default async (req: Request, context: Context) => {
  const id = context.params?.id;

  try {
    if (req.method === "GET" && !id) return list();
    if (req.method === "POST" && !id) return create(req);
    if (req.method === "PATCH" && id) return patch(req, id);
    if (req.method === "DELETE" && id) return remove(id);
    return error("Method not allowed.", 405);
  } catch (e) {
    console.error("members error", e);
    return error("Server error.", 500);
  }
};

export const config: Config = {
  path: ["/api/members", "/api/members/:id"],
};
