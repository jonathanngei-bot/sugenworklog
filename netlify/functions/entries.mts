import type { Config, Context } from "@netlify/functions";
import { db, error, json, readBody, str, uid } from "../lib/db.mts";

export interface Entry {
  id: string;
  submitted_by: string;
  date: string;
  hours: string;
  project: string;
  work: string;
  notes: string;
}

const SELECT = `id, submitted_by, to_char(date, 'YYYY-MM-DD') AS date,
                hours::text AS hours, project, work, notes`;

/** GET /api/entries â€” every saved work entry, newest date first. */
async function list(): Promise<Response> {
  const rows = await db.sql<Entry>`
    SELECT ${db.sql.raw(SELECT)}
      FROM entries
     ORDER BY date DESC, created_at DESC`;
  return json({ entries: rows });
}

/** POST /api/entries â€” create a work entry. */
async function create(req: Request): Promise<Response> {
  const body = await readBody(req);
  const date = str(body.date);
  const work = str(body.work);
  const project = str(body.project);

  if (!date) return error("Date is required.");
  if (!work) return error("Work completed is required.");
  if (!project) return error("Project or site is required.");

  // Hours are no longer typed in by staff — they default to 0 when absent
  // (real hours are calculated automatically from check-in / check-out).
  const hoursRaw = body.hours;
  const hours = hoursRaw == null || hoursRaw === "" ? 0 : Number(hoursRaw);
  if (!Number.isFinite(hours) || hours < 0) return error("Hours worked must be a number.");

  const id = str(body.id) || uid();
  const submittedBy = str(body.submittedBy);
  const notes = str(body.notes);

  // Upsert so a device re-pushing its local copy can never fail on a duplicate id.
  const rows = await db.sql<Entry>`
    INSERT INTO entries (id, submitted_by, date, hours, project, work, notes)
    VALUES (${id}, ${submittedBy}, ${date}, ${hours}, ${project}, ${work}, ${notes})
    ON CONFLICT (id) DO UPDATE
       SET submitted_by = EXCLUDED.submitted_by,
           date = EXCLUDED.date,
           hours = EXCLUDED.hours,
           project = EXCLUDED.project,
           work = EXCLUDED.work,
           notes = EXCLUDED.notes,
           updated_at = NOW()
    RETURNING id, submitted_by, to_char(date, 'YYYY-MM-DD') AS date,
               hours::text AS hours, project, work, notes`;

  return json({ entry: rows[0] }, 201);
}

/** PUT /api/entries/:id â€” replace an existing entry. */
async function update(req: Request, id: string): Promise<Response> {
  const body = await readBody(req);
  const date = str(body.date);
  const work = str(body.work);
  const project = str(body.project);

  if (!date) return error("Date is required.");
  if (!work) return error("Work completed is required.");
  if (!project) return error("Project or site is required.");

  const hoursRaw = body.hours;
  const hours = hoursRaw == null || hoursRaw === "" ? 0 : Number(hoursRaw);
  if (!Number.isFinite(hours) || hours < 0) return error("Hours worked must be a number.");

  const rows = await db.sql<Entry>`
    UPDATE entries
       SET submitted_by = ${str(body.submittedBy)},
           date = ${date},
           hours = ${hours},
           project = ${project},
           work = ${work},
           notes = ${str(body.notes)},
           updated_at = NOW()
     WHERE id = ${id}
    RETURNING id, submitted_by, to_char(date, 'YYYY-MM-DD') AS date,
               hours::text AS hours, project, work, notes`;

  if (!rows.length) return error("Entry not found.", 404);
  return json({ entry: rows[0] });
}

/** DELETE /api/entries/:id */
async function remove(id: string): Promise<Response> {
  const rows = await db.sql<{ id: string }[]>`DELETE FROM entries WHERE id = ${id} RETURNING id`;
  if (!rows.length) return error("Entry not found.", 404);
  return json({ ok: true, id });
}

export default async (req: Request, context: Context) => {
  const id = context.params?.id;

  try {
    if (req.method === "GET" && !id) return list();
    if (req.method === "POST" && !id) return create(req);
    if (req.method === "PUT" && id) return update(req, id);
    if (req.method === "DELETE" && id) return remove(id);
    return error("Method not allowed.", 405);
  } catch (e) {
    console.error("entries error", e);
    return error("Server error.", 500);
  }
};

export const config: Config = {
  path: ["/api/entries", "/api/entries/:id"],
};
