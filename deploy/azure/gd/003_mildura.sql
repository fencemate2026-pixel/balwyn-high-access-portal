-- STAGED, NOT APPLIED. Mildura Working Men's Club boom gate: Azure copy of the Pi's mirror + sealed command queue.
-- Replaces the Supabase gd-mirror function (project aevsfrxqyvtuycufffxk, HTTP 402 on 7 Nov 2026).
-- Run once on the Azure PostgreSQL server as the administrator, AFTER 001_thomastown_swing.sql (it needs schema gd,
-- role gd_app and table gd.devices). Additive: new tables and 3 nullable columns on gd.devices. Re-running is harmless.
-- Rollback: 003_mildura_rollback.sql.
--
-- What is held:
--   * User and schedule NAMES, authorised-person names/roles, access history, change history (as on Supabase).
--   * mildura_access_pins: the PIN actually typed at each access event (owner request, 6 Nov 2026). Only the
--     owner-gated portal path reads it; it is a separate table from mildura_access.
--   * mildura_commands.sealed: RSA-OAEP ciphertext to the Pi's own public key, wiped the moment a command finishes.
--     PINs and phone numbers are NEVER stored in plaintext here (constraints below enforce it).
--   * secret_sha256: sha256 of the Pi's device secret (the secret itself is never stored). Set separately at apply
--     time, NOT in this file, together with command_pubkey (the Pi's public key).

ALTER TABLE gd.devices ADD COLUMN IF NOT EXISTS secret_sha256 text CHECK (secret_sha256 IS NULL OR secret_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE gd.devices ADD COLUMN IF NOT EXISTS command_pubkey text;
ALTER TABLE gd.devices ADD COLUMN IF NOT EXISTS command_pubkey_at timestamptz;

CREATE TABLE IF NOT EXISTS gd.mildura_users (
  device_id text NOT NULL REFERENCES gd.devices(device_id) ON DELETE CASCADE,
  local_id bigint NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  schedule_type text, schedule_data text, created_at_local text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, local_id)
);
CREATE TABLE IF NOT EXISTS gd.mildura_schedules (
  device_id text NOT NULL REFERENCES gd.devices(device_id) ON DELETE CASCADE,
  local_id bigint NOT NULL,
  name text, days text, open_time text, close_time text,
  enabled boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, local_id)
);
CREATE TABLE IF NOT EXISTS gd.mildura_persons (
  device_id text NOT NULL REFERENCES gd.devices(device_id) ON DELETE CASCADE,
  local_id bigint NOT NULL,
  name text, role text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, local_id)
);
CREATE TABLE IF NOT EXISTS gd.mildura_access (
  device_id text NOT NULL REFERENCES gd.devices(device_id) ON DELETE CASCADE,
  local_id bigint NOT NULL,
  occurred_at_local text, user_name text, method text, success boolean,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, local_id)
);
CREATE INDEX IF NOT EXISTS gd_mildura_access_time ON gd.mildura_access(device_id, occurred_at_local DESC);
CREATE TABLE IF NOT EXISTS gd.mildura_access_pins (
  device_id text NOT NULL,
  local_id bigint NOT NULL,
  attempted_pin text NOT NULL CHECK (attempted_pin ~ '^[0-9]{1,16}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, local_id),
  FOREIGN KEY (device_id, local_id) REFERENCES gd.mildura_access(device_id, local_id) ON DELETE CASCADE
);
-- Pi rows carry the Pi's positive local id; portal audit rows omit it and get a negative id, so they never collide.
CREATE SEQUENCE IF NOT EXISTS gd.mildura_portal_audit_seq;
CREATE TABLE IF NOT EXISTS gd.mildura_changes (
  device_id text NOT NULL REFERENCES gd.devices(device_id) ON DELETE CASCADE,
  local_id bigint NOT NULL DEFAULT (-nextval('gd.mildura_portal_audit_seq')),
  occurred_at_local text, action text, detail text, changed_by text,
  source text NOT NULL DEFAULT 'pi' CHECK (source IN ('pi','portal')),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, local_id)
);
CREATE INDEX IF NOT EXISTS gd_mildura_changes_time ON gd.mildura_changes(device_id, occurred_at_local DESC);

CREATE TABLE IF NOT EXISTS gd.mildura_commands (
  id uuid PRIMARY KEY,
  device_id text NOT NULL REFERENCES gd.devices(device_id) ON DELETE CASCADE,
  seq bigserial NOT NULL,
  client_key uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'user.add','user.update','user.delete','user.enable','users.enable_all',
    'schedule.add','schedule.enable','schedule.delete','person.add','person.delete',
    'gate.open','gate.lockdown')),
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  sealed text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','applied','failed','expired')),
  actor_email text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  error text, result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz, finished_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  CONSTRAINT mildura_commands_no_plain_secret CHECK (NOT (args ?| array['pin','phone','PIN','Pin'])),
  CONSTRAINT mildura_commands_sealed_only_while_open CHECK (sealed IS NULL OR status IN ('pending','delivered')),
  CONSTRAINT mildura_commands_sealed_size CHECK (sealed IS NULL OR length(sealed) BETWEEN 16 AND 2048),
  UNIQUE (device_id, client_key)
);
CREATE INDEX IF NOT EXISTS gd_mildura_commands_open ON gd.mildura_commands(device_id, seq) WHERE status IN ('pending','delivered');

-- Belt and braces: whatever path finishes a command, the ciphertext goes with it.
CREATE OR REPLACE FUNCTION gd.mildura_commands_wipe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('pending','delivered') THEN NEW.sealed := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mildura_commands_wipe ON gd.mildura_commands;
CREATE TRIGGER mildura_commands_wipe BEFORE INSERT OR UPDATE ON gd.mildura_commands
  FOR EACH ROW EXECUTE FUNCTION gd.mildura_commands_wipe();

-- Access: gd_app only, exactly as 001. The school role balwyn_app and PUBLIC are shut out.
REVOKE ALL ON ALL TABLES IN SCHEMA gd FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA gd FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'balwyn_app') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA gd FROM balwyn_app';
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gd TO gd_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA gd TO gd_app;

-- The one device row. Name only: the secret hash and public key are set separately (see README).
INSERT INTO gd.devices(device_id, site_name)
VALUES ('mildura-001', 'Mildura Working Men''s Club - boom gate')
ON CONFLICT (device_id) DO NOTHING;
