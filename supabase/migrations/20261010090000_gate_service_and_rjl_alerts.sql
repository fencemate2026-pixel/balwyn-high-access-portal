-- Gate operation counters, service tracking and RJL alert outbox (10 Oct 2026).
--
-- gate_service_counters: one row per gate. Counts every opening that Magic Keys
-- itself triggered and confirmed (a remote-open pulse acknowledged by the door
-- service, or a controller OPEN acknowledged by the gate controller). Openings
-- by fob, keypad, exit button or the school's own system are NOT counted until
-- gate position sensors are fitted; the dashboard says so.
--
-- rjl_notifications: every alert the portal sends to RJL (service due, service
-- warning, flagged help-assistant question, system issue such as the help AI
-- being unavailable) is written here first, then emailed.
-- Nothing is lost if email is not configured or fails. Rows older than 12 months
-- are deleted by the application when a new alert is written.

CREATE TABLE IF NOT EXISTS balwyn_portal.gate_service_counters (
  gate_id                  text PRIMARY KEY CHECK (char_length(gate_id) BETWEEN 1 AND 40),
  total_operations         integer NOT NULL DEFAULT 0 CHECK (total_operations >= 0),
  operations_since_service integer NOT NULL DEFAULT 0 CHECK (operations_since_service >= 0),
  last_service_at          timestamptz,
  -- 0 = no alert sent this service period, 1 = early warning sent, 2 = service-due alert sent
  alert_level              smallint NOT NULL DEFAULT 0 CHECK (alert_level BETWEEN 0 AND 2),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE balwyn_portal.gate_service_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.gate_service_counters;
CREATE POLICY balwyn_server_access ON balwyn_portal.gate_service_counters TO balwyn_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON balwyn_portal.gate_service_counters TO balwyn_app;

CREATE TABLE IF NOT EXISTS balwyn_portal.rjl_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL CHECK (kind IN ('service_due', 'service_warning', 'help_flag', 'system_issue', 'gate_fault')),
  subject     text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  delivery    text NOT NULL DEFAULT 'pending' CHECK (delivery IN ('pending', 'sent', 'failed', 'not_configured')),
  sent_at     timestamptz,
  error       text CHECK (error IS NULL OR char_length(error) <= 120)
);

CREATE INDEX IF NOT EXISTS idx_rjl_notifications_created ON balwyn_portal.rjl_notifications (created_at DESC);

ALTER TABLE balwyn_portal.rjl_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.rjl_notifications;
CREATE POLICY balwyn_server_access ON balwyn_portal.rjl_notifications TO balwyn_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON balwyn_portal.rjl_notifications TO balwyn_app;

-- Help-assistant question log: allow the application to delete rows older than
-- 12 months (retention). Only if that table exists on this database.
DO $$ BEGIN
  IF to_regclass('balwyn_portal.help_events') IS NOT NULL THEN
    GRANT DELETE ON balwyn_portal.help_events TO balwyn_app;
  END IF;
END $$;

-- The audit trail is append-only for the application role: it may add entries
-- and read them, never change or remove them.
REVOKE UPDATE, DELETE ON balwyn_portal.activity_log FROM balwyn_app;
