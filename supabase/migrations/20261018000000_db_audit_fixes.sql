-- DB audit fixes (18 Oct 2026) — AUDIT_DB.md P2-1, P2-2, P2-3, P2-4 (partial,
-- see note below), P2-5, and search_path hardening related to P3 items.
-- Idempotent: safe to re-run (IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS
-- throughout, matching the house style used in earlier migrations).

-- ---------------------------------------------------------------------------
-- P2-1: activity_log has no index supporting the actor_name filter used by
-- lib/staff-presence.ts's admin activity lookup (WHERE actor_name = ?
-- ORDER BY id DESC LIMIT 100). Only idx_activity_log_created_at existed.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_activity_log_actor
  ON balwyn_portal.activity_log (actor_name, id DESC);

-- ---------------------------------------------------------------------------
-- P2-2 / P2-3: activity_log and auth_attempts have no retention policy.
--
-- Every other append-heavy table (rjl_notifications, help_events,
-- staff_presence/staff_ui_events) is purged by the APPLICATION deleting old
-- rows opportunistically when it writes a new one. That pattern cannot be
-- reused for activity_log: 20261010090000_gate_service_and_rjl_alerts.sql
-- deliberately REVOKEs UPDATE, DELETE on activity_log FROM balwyn_app so the
-- audit trail is append-only for the app role — granting DELETE back to
-- balwyn_app to let the app purge it would undo that deliberate hardening.
--
-- So this uses the fallback AUDIT_DB.md itself suggests: a scheduled
-- pg_cron job, run as the migration role (not balwyn_app), via a
-- SECURITY DEFINER function with an explicit search_path (defence in depth —
-- a SECURITY DEFINER function with a mutable search_path can be tricked by a
-- caller who can influence search_path into resolving an unqualified name to
-- an attacker-controlled object; pinning it closes that off regardless of
-- caller state).
--
-- auth_attempts retention: 90 days (low write volume, but unbounded —
-- AUDIT_DB.md P2-3). activity_log retention: 24 months (it is the audit
-- trail; kept longer than the operational logs it dwarfs in write volume).
--
-- pg_cron may not be enabled on every environment this migration runs
-- against (e.g. a local/non-Supabase Postgres). Both the extension and the
-- schedule call are wrapped so a missing/unprivileged pg_cron does not fail
-- the whole migration.
CREATE OR REPLACE FUNCTION balwyn_portal.cleanup_expired_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = balwyn_portal, pg_catalog
AS $$
BEGIN
  DELETE FROM balwyn_portal.activity_log
   WHERE created_at::timestamptz < (now() - interval '24 months');
  DELETE FROM balwyn_portal.auth_attempts
   WHERE created_at::timestamptz < (now() - interval '90 days');
END;
$$;

COMMENT ON FUNCTION balwyn_portal.cleanup_expired_logs() IS
  'Retention sweep for activity_log (24 months) and auth_attempts (90 days). '
  'SECURITY DEFINER because balwyn_app has no DELETE on activity_log by '
  'design (append-only audit trail) — this function runs with the schema '
  'owner''s privileges instead. Scheduled nightly via pg_cron if available; '
  'see the DO block below.';

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  -- Covers insufficient_privilege, feature_not_supported, a missing extension
  -- control file, or anything else this platform's pg_cron support might
  -- raise: none of them should fail this whole migration.
  RAISE NOTICE 'pg_cron extension not available in this database — skipping '
    'scheduled retention cleanup. Run balwyn_portal.cleanup_expired_logs() '
    'manually or via an external scheduler instead.';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- cron.schedule() upserts by job name on recent pg_cron versions, but
    -- unschedule first so this is safe to re-run on older ones too.
    PERFORM cron.unschedule(jobid)
      FROM cron.job WHERE jobname = 'balwyn_portal_retention_cleanup';
    PERFORM cron.schedule(
      'balwyn_portal_retention_cleanup',
      '17 3 * * *', -- 03:17 daily (server time), off the top of the hour
      $job$SELECT balwyn_portal.cleanup_expired_logs();$job$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule balwyn_portal_retention_cleanup via '
    'pg_cron — the function balwyn_portal.cleanup_expired_logs() exists and '
    'can still be invoked manually or from an external scheduler.';
END $$;

-- ---------------------------------------------------------------------------
-- P2-4: schedules/automation_rules reads on the controller-poll hot path
-- (lib/portal-store.ts loadGateWindows, ~1 req/s per active gate).
--
-- NOTE (verified from source, 18 Oct 2026): the actual queries at
-- lib/portal-store.ts:468-469 are unconditional `db.select().from(schedules)`
-- / `db.select().from(automationRules)` with no WHERE clause at all — every
-- row, every column. An index cannot avoid a full-table scan for a query
-- with no predicate; the genuine fix is the one AUDIT_DB.md itself names
-- (cache the schedule/automation-rule set per gate for a few seconds and
-- invalidate on write), which is application code in lib/portal-store.ts and
-- out of this migration/edge-function-only pass's scope.
--
-- What IS a legitimate migration-level improvement, and is added here: both
-- tables are tiny today but unbounded (no retention — automation_rules in
-- particular can only grow), and `enabled`/`gate_id` are the columns any
-- future narrowed query (or a cache-invalidation query) would filter on.
-- Adding these now costs nothing and means the day someone narrows the
-- query, the index is already there.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled
  ON balwyn_portal.automation_rules (enabled);

CREATE INDEX IF NOT EXISTS idx_gate_schedules_gate_enabled
  ON balwyn_portal.gate_schedules (gate_id, enabled);

-- ---------------------------------------------------------------------------
-- P2-5: hire_bookings' partial status index only covers ('enquiry',
-- 'confirmed'), but loadGateWindows' scheduling-window query
-- (lib/portal-store.ts:485) filters on status IN ('confirmed','completed').
-- 'completed' bookings fall outside the index, so that query likely falls
-- back to a sequential scan. Widen the partial index to cover every status
-- value any current query filters on.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS balwyn_portal.idx_hire_bookings_status;
CREATE INDEX idx_hire_bookings_status ON balwyn_portal.hire_bookings (status)
  WHERE status IN ('enquiry', 'confirmed', 'completed');

-- ---------------------------------------------------------------------------
-- search_path hardening (relates to the P3 "mutable search_path" class of
-- finding). The only function actually present in this migration history
-- (verified from source — grepped every migration for FUNCTION/TRIGGER;
-- balwyn_portal.hire_touch_updated_at is the only one defined in SQL here)
-- did not pin search_path. It is not SECURITY DEFINER so it carries no
-- privilege-escalation risk, but pinning it is cheap and removes any
-- ambiguity about which `now()`/schema a future edit might resolve against.
--
-- NOTE: the brief for this pass referenced "8 functions with mutable
-- search_path, from Supabase advisors". Only the one function below is
-- visible in this source tree's migrations; the other 7 could not be
-- located or verified from source in this snapshot (they may be Supabase-
-- managed/extension functions, or functions created outside the migration
-- history e.g. directly on the live project). Not fabricating a fix for
-- functions that can't be found in source — flagging for Jarrod to confirm
-- against the live `get_advisors` output, which this offline pass had no
-- access to.
-- ---------------------------------------------------------------------------
ALTER FUNCTION balwyn_portal.hire_touch_updated_at() SET search_path = pg_catalog;
