-- Work Diary core tables
-- IDs are TEXT so the frontend's existing crypto.randomUUID() values keep working.

CREATE TABLE IF NOT EXISTS members (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entries (
  id           TEXT PRIMARY KEY,
  submitted_by TEXT NOT NULL DEFAULT '',
  date         DATE NOT NULL,
  hours        NUMERIC NOT NULL DEFAULT 0,
  project      TEXT NOT NULL DEFAULT '',
  work         TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  work_date   DATE NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('in', 'out')),
  time        TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entries_date_idx ON entries (date DESC);
CREATE INDEX IF NOT EXISTS attendance_day_idx ON attendance (work_date);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_member_day_idx ON attendance (member_id, work_date);
