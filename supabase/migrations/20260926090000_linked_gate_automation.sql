-- Linked gate automation (26 Sep 2026).
--
-- 1. A facility-hire booking can hold one or more active gates open for its
--    duration, with a lead-in and a run-out. The controller-poll engine reads
--    these rows; the calendar reads the same rows, so what the calendar shows is
--    what the engine does.
-- 2. automation_rules gains a typed kind + JSON config. Existing rows become
--    kind 'note' (stored text, never executed), so nothing that was saved before
--    starts moving a gate.
--
-- Additive only: no existing column, row or policy is changed or removed.

CREATE TABLE IF NOT EXISTS balwyn_portal.hire_booking_gates (
  booking_id    uuid NOT NULL REFERENCES balwyn_portal.hire_bookings(id) ON DELETE CASCADE,
  gate_id       text NOT NULL CHECK (gate_id ~ '^[A-Z0-9-]{2,40}$'),
  lead_minutes  integer NOT NULL DEFAULT 15 CHECK (lead_minutes BETWEEN 0 AND 120),
  lag_minutes   integer NOT NULL DEFAULT 15 CHECK (lag_minutes BETWEEN 0 AND 120),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL DEFAULT 'system',
  PRIMARY KEY (booking_id, gate_id)
);
CREATE INDEX IF NOT EXISTS idx_hire_booking_gates_gate ON balwyn_portal.hire_booking_gates (gate_id);

ALTER TABLE balwyn_portal.hire_booking_gates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.hire_booking_gates;
CREATE POLICY balwyn_server_access ON balwyn_portal.hire_booking_gates TO balwyn_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON balwyn_portal.hire_booking_gates TO balwyn_app;

ALTER TABLE balwyn_portal.automation_rules
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'note';
ALTER TABLE balwyn_portal.automation_rules
  ADD COLUMN IF NOT EXISTS config text;
DO $$ BEGIN
  ALTER TABLE balwyn_portal.automation_rules
    ADD CONSTRAINT automation_rules_kind CHECK (kind IN ('note', 'gate_window'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE balwyn_portal.automation_rules
    ADD CONSTRAINT automation_rules_config_present CHECK (kind = 'note' OR (config IS NOT NULL AND length(config) <= 2000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
