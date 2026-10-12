import type { Config } from "@netlify/functions";
import { createHash } from "node:crypto";
import { db, error, json, readBody, str } from "../lib/db.mts";

/** Hashing keeps raw PINs out of the database and out of any API response. */
function hashPin(pin: string): string {
  return createHash("sha256").update(`work-diary:${pin}`).digest("hex");
}

interface PinRow {
  member_id: string;
  pin_hash: string;
}

interface MemberRow {
  id: string;
  name: string;
  status: string;
}

/**
 * POST /api/pins
 *   { memberId, pin }  â†’ save a PIN (admin action). Never returns stored PINs.
 *   { name, pin }      â†’ verify a staff login. Returns ok:true or 401.
 */
export default async (req: Request) => {
  if (req.method !== "POST") return error("Method not allowed.", 405);

  const body = await readBody(req);
  const pin = str(body.pin);
  if (!/^\d{4,8}$/.test(pin)) return error("Use a 4 to 8 digit PIN.");

  try {
    // Verify a login by staff name.
    const name = str(body.name);
    if (name) {
      const members = await db.sql<MemberRow>`
        SELECT id, name, status FROM members WHERE lower(name) = lower(${name})`;
      const member = members[0];

      if (!member || member.status === "inactive") {
        return error("Staff member not found or inactive.", 401);
      }

      const stored = await db.sql<PinRow>`
        SELECT member_id, pin_hash FROM staff_pins WHERE member_id = ${member.id}`;

      // No PIN set yet for this member: allow the documented default, but
      // seed it so it stops being a default from then on.
      const expected = stored[0]?.pin_hash;
      const matches = expected ? expected === hashPin(pin) : pin === "1234";

      if (!matches) return error("The PIN is not correct. Try again.", 401);

      if (!expected) {
        await db.sql`
          INSERT INTO staff_pins (member_id, pin_hash, updated_at)
          VALUES (${member.id}, ${hashPin(pin)}, NOW())
          ON CONFLICT (member_id) DO NOTHING`;
      }

      return json({ ok: true, member: { id: member.id, name: member.name } });
    }

    // Save a PIN (admin action).
    const memberId = str(body.memberId);
    if (!memberId) return error("memberId is required.");

    await db.sql`
      INSERT INTO staff_pins (member_id, pin_hash, updated_at)
      VALUES (${memberId}, ${hashPin(pin)}, NOW())
      ON CONFLICT (member_id)
      DO UPDATE SET pin_hash = EXCLUDED.pin_hash, updated_at = NOW()`;

    return json({ ok: true, memberId });
  } catch (e) {
    console.error("pins error", e);
    return error("Server error.", 500);
  }
};

export const config: Config = { path: "/api/pins" };
