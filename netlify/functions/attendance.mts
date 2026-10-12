import type { Config, Context } from "@netlify/functions";
import { db, error, json, readBody, str, uid } from "../lib/db.mts";

export interface Attendance {
  member_id: string;
  member_name: string;
  work_date: string;
  status: string;
  time: string;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SELECT = `a.member_id, m.name AS member_name,
                to_char(a.work_date, 'YYYY-MM-DD') AS work_date,
                a.status, a.time
                  FROM attendance a
                  JOIN members m ON m.id = a.member_id`;

/**
 * GET  /api/attendance?date=YYYY-MM-DD  â†’ attendance rows for a day (defaults to today)
 * POST /api/attendance                  â†’ set a member's check-in/check-out status
 */
export default async (req: Request, context: Context) => {
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const date = str(url.searchParams.get("date")) || today();
      const rows = await db.sql<Attendance>`
        SELECT ${db.sql.raw(SELECT)} WHERE a.work_date = ${date} ORDER BY m.name ASC`;
      return json({ date, attendance: rows });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const memberId = str(body.memberId);
      const status = str(body.status);

      if (!memberId) return error("memberId is required.");
      if (status !== "in" && status !== "out") return error("Status must be 'in' or 'out'.");

      const date = str(body.date) || today();
      const time = str(body.time) ||
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      // Upsert: one row per member per day.
      const rows = await db.sql<Attendance>`
        INSERT INTO attendance (id, member_id, work_date, status, time, updated_at)
        VALUES (${uid()}, ${memberId}, ${date}, ${status}, ${time}, NOW())
        ON CONFLICT (member_id, work_date)
        DO UPDATE SET status = EXCLUDED.status, time = EXCLUDED.time, updated_at = NOW()
        RETURNING member_id, to_char(work_date, 'YYYY-MM-DD') AS work_date, status, time`;

      return json({ record: rows[0] }, 201);
    }

    return error("Method not allowed.", 405);
  } catch (e) {
    console.error("attendance error", e);
    return error("Server error.", 500);
  }
};

export const config: Config = { path: "/api/attendance" };
