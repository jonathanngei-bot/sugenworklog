-- Staff login PINs, stored hashed so the API never exposes the raw value.

CREATE TABLE IF NOT EXISTS staff_pins (
  member_id  TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  pin_hash   TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
