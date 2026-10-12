import type { Config, Context } from "@netlify/functions";
import { db, error, json, readBody, str } from "../lib/db.mts";

export interface Setting {
  key: string;
  value: string;
}

/** GET    /api/settings          â†’ all key/value pairs */
/** GET    /api/settings/:key     â†’ one value */
/** PUT    /api/settings/:key     â†’ save { value } */
/** DELETE /api/settings/:key     â†’ clear a key */
export default async (req: Request, context: Context) => {
  const key = context.params?.key ? str(context.params.key) : "";

  try {
    if (req.method === "GET" && !key) {
      const rows = await db.sql<Setting>`SELECT key, value FROM settings ORDER BY key ASC`;
      return json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
    }

    if (req.method === "GET" && key) {
      const rows = await db.sql<Setting>`SELECT key, value FROM settings WHERE key = ${key}`;
      return json({ key, value: rows[0]?.value ?? "" });
    }

    if (req.method === "PUT" && key) {
      const body = await readBody(req);
      const value = str(body.value);

      const rows = await db.sql<Setting>`
        INSERT INTO settings (key, value, updated_at)
        VALUES (${key}, ${value}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        RETURNING key, value`;

      return json({ setting: rows[0] });
    }

    if (req.method === "DELETE" && key) {
      await db.sql`DELETE FROM settings WHERE key = ${key}`;
      return json({ ok: true, key });
    }

    return error("Method not allowed.", 405);
  } catch (e) {
    console.error("settings error", e);
    return error("Server error.", 500);
  }
};

export const config: Config = { path: ["/api/settings", "/api/settings/:key"] };
