-- Members are matched by name when a device re-syncs without an id,
-- so ON CONFLICT (name) needs a unique index.

CREATE UNIQUE INDEX IF NOT EXISTS members_name_key ON members (name);
