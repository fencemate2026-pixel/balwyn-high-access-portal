-- STAGED, NOT APPLIED. Thomastown swing gate: Azure mirror + signed command queue.
-- Run once on the Azure PostgreSQL server as the administrator, AFTER the Balwyn schema.
-- Additive only: creates schema "gd" and one login role. Touches no balwyn_portal object.
-- Rollback: 001_thomastown_swing_rollback.sql.
--
-- Separation rule (same as the Supabase gd_* tables): the school portal's restricted role
-- balwyn_app is DENIED everything in this schema, so a school-portal bug can never read a
-- client's caller list. Only the owner-gated routes and the device route connect as gd_app.
--
-- Data held: caller NAME + PHONE NUMBER (the number is the credential on this site),
-- enabled/schedule, call history, change history. No PINs, no admin credentials, no secrets.
-- The device HMAC secret is NOT stored here; it lives in the App Service setting
-- GD_THOMASTOWN_SWING_SECRET (Key Vault reference recommended).

CREATE SCHEMA IF NOT EXISTS gd;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gd_app') THEN
    CREATE ROLE gd_app NOLOGIN;       -- give it a login + password separately; see deploy/azure/gd/README.md
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS gd.devices (
  device_id    text PRIMARY KEY CHECK (device_id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  site_name    text NOT NULL,
  last_seen    timestamptz,
  fw_version   text,
  last_status  jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Snapshot tables: replaced in full whenever the Pi's copy changes (small).
CREATE TABLE IF NOT EXISTS gd.users (
  device_id        text   NOT NULL REFERENCES gd.devices(device_id) ON DELETE CASCADE,
  local_id         bigint NOT NULL,
  name             text   NOT NULL,
  phone            text   NOT NULL,
  enabled          boolean NOT NULL DEFAULT true,
  schedule_type    text,
  schedule_data    text,
  created_at_local text,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, local_id)
);
CREATE INDEX IF NOT EXISTS gd_users_phone ON gd.users(device_id, phone);

-- Stream tables: append-only, keyed by the Pi's own row id, so a resend is harmless.
CREATE TABLE IF NOT EXISTS gd.access_log (
  device_id        text   NOT NULL REFERENCES gd.devices(device_id) ON DELETE CASCADE,
  local_id         bigint NOT NULL,
  occurred_at_local text,
  user_name        text,
  method           text,
  success          boolean,
  received_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, local_id)
);
-- Note: the gate app logs an unlisted caller's NUMBER as user_name (app.on_call), so access_log
-- already carries every call that reached the policy check; no gate-app change is needed.
CREATE SEQUENCE IF NOT EXISTS gd.portal_audit_seq;
CREATE TABLE IF NOT EXISTS gd.changes (
  device_id        text   NOT NULL REFERENCES gd.devices(device_id) ON DELETE CASCADE,
  local_id         bigint NOT NULL DEFAULT (-nextval('gd.portal_audit_seq')),   -- portal rows are negative
  occurred_at_local text,
  action           text,
  detail           text,
  changed_by       text,
  source           text NOT NULL DEFAULT 'pi' CHECK (source IN ('pi','portal')),
  received_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, local_id)
);
CREATE INDEX IF NOT EXISTS gd_access_time  ON gd.access_log(device_id, local_id DESC);
CREATE INDEX IF NOT EXISTS gd_changes_time ON gd.changes(device_id, received_at DESC);

CREATE TABLE IF NOT EXISTS gd.commands (
  id          uuid PRIMARY KEY,
  device_id   text NOT NULL REFERENCES gd.devices(device_id) ON DELETE CASCADE,
  seq         bigserial NOT NULL,
  client_key  uuid NOT NULL,                       -- double-click / retry guard from the browser
  kind        text NOT NULL CHECK (kind IN ('user.add','user.update','user.delete','user.enable')),
  args        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','applied','failed','expired')),
  actor_email text NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  error       text,
  result      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  finished_at timestamptz,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  UNIQUE (device_id, client_key)
);
CREATE INDEX IF NOT EXISTS gd_commands_open ON gd.commands(device_id, seq) WHERE status IN ('pending','delivered');

-- Replay guard for signed device requests (rows older than 10 minutes are deleted on each use).
CREATE TABLE IF NOT EXISTS gd.device_nonces (
  device_id text NOT NULL,
  nonce     text NOT NULL,
  seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, nonce)
);

-- Access: gd_app only. Everyone else (including balwyn_app and PUBLIC) is shut out.
REVOKE ALL ON SCHEMA gd FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA gd FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA gd FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'balwyn_app') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA gd FROM balwyn_app';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA gd FROM balwyn_app';
  END IF;
END $$;
GRANT USAGE ON SCHEMA gd TO gd_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gd TO gd_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA gd TO gd_app;

-- The one device row. Name only; no secret.
INSERT INTO gd.devices(device_id, site_name)
VALUES ('thomastown-swing', 'Macquarie Drive Thomastown')
ON CONFLICT (device_id) DO NOTHING;
