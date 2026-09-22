CREATE SCHEMA IF NOT EXISTS balwyn_portal;

CREATE TABLE IF NOT EXISTS balwyn_portal.system_state (
  id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'normal',
  lockdown_active BOOLEAN NOT NULL DEFAULT FALSE,
  fire_alarm_active BOOLEAN NOT NULL DEFAULT FALSE,
  muster_point TEXT NOT NULL DEFAULT 'Western oval assembly',
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS balwyn_portal.gate_states (
  gate_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone TEXT NOT NULL,
  status TEXT NOT NULL,
  automation_mode TEXT NOT NULL,
  relay_channel INTEGER NOT NULL,
  open_percent INTEGER NOT NULL DEFAULT 0,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issue TEXT,
  camera_online BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS balwyn_portal.access_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone TEXT NOT NULL,
  credential_group TEXT NOT NULL,
  schedule TEXT NOT NULL,
  threat_level_limit TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS balwyn_portal.automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  gate_id TEXT NOT NULL REFERENCES balwyn_portal.gate_states(gate_id),
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  days TEXT[] NOT NULL,
  action TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'scheduled'
);

CREATE TABLE IF NOT EXISTS balwyn_portal.hire_requests (
  id TEXT PRIMARY KEY,
  organisation TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  location TEXT NOT NULL,
  start_iso TIMESTAMPTZ NOT NULL,
  end_iso TIMESTAMPTZ NOT NULL,
  expected_attendance INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS balwyn_portal.activity_log (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  severity TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
