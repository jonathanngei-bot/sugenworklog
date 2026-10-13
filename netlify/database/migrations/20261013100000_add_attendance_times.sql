-- Hours worked are no longer typed in: they are calculated from check-in to check-out.

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in  TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hours     NUMERIC NOT NULL DEFAULT 0;
