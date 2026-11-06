-- STAGED, NOT APPLIED. Hold-open windows for the Azure-backed gates (Thomastown swing + sliding).
-- Run as the Azure PostgreSQL administrator, AFTER 001 (and 002). Additive: one new table and one widened
-- CHECK on gd.commands.kind. Re-runnable. Rollback: 003_hold_windows_rollback.sql.
-- The Pi's own database stays the authority; this is a mirror of its windows plus the owner's queued edits.

CREATE TABLE IF NOT EXISTS gd.hold_windows (
  device_id   text   NOT NULL REFERENCES gd.devices(device_id) ON DELETE CASCADE,
  local_id    bigint NOT NULL,
  name        text   NOT NULL,
  days        smallint[] NOT NULL,                 -- Monday=0 .. Sunday=6
  open_time   text   NOT NULL CHECK (open_time  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  close_time  text   NOT NULL CHECK (close_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  enabled     boolean NOT NULL DEFAULT true,
  synced_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, local_id)
);

ALTER TABLE gd.commands DROP CONSTRAINT IF EXISTS commands_kind_check;
ALTER TABLE gd.commands ADD CONSTRAINT commands_kind_check CHECK (kind IN
  ('user.add','user.update','user.delete','user.enable','hold.add','hold.update','hold.delete','hold.enable'));

REVOKE ALL ON gd.hold_windows FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'balwyn_app') THEN
    EXECUTE 'REVOKE ALL ON gd.hold_windows FROM balwyn_app';
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON gd.hold_windows TO gd_app;
