-- Leftover IDs from an old Balwyn gate register. The live Magic Keys model
-- only lists nine access points (see lib/portal-model.ts). These 15 records
-- must not appear as commissioned hardware.
--
-- This is an ad-hoc script, not a numbered supabase/migrations/*.sql file: it
-- runs once by hand against a known-bad snapshot, not as part of the normal
-- migration history. Before running against production:
--   1. Take a fresh backup/snapshot of the `balwyn_portal` schema.
--   2. Review this file and the row counts below against the current
--      register (lib/portal-model.ts) — do not run it unattended.
-- The explicit BEGIN/COMMIT below is this script's own safety net: if
-- anything fails partway (e.g. a foreign-key constraint on `gate_runtime`),
-- the transaction rolls back and neither table is left half-cleaned. Local
-- safety circuits and the current nine-gate register stay authoritative.

BEGIN;

DELETE FROM gate_runtime
WHERE gate_id IN (
  'SCP-B01','SCP-B02','SCP-B03','SCP-B04','SCP-B05','SCP-B06',
  'SCP-B07','SCP-B08','SCP-B09','SCP-B10','SCP-B11','SCP-B12',
  'FRONT-DG01','FRONT-DG02','FRONT-DG03'
);

DELETE FROM gates
WHERE id IN (
  'SCP-B01','SCP-B02','SCP-B03','SCP-B04','SCP-B05','SCP-B06',
  'SCP-B07','SCP-B08','SCP-B09','SCP-B10','SCP-B11','SCP-B12',
  'FRONT-DG01','FRONT-DG02','FRONT-DG03'
);

-- Review the row counts affected above before committing. Replace COMMIT
-- with ROLLBACK and re-run if either DELETE touched an unexpected number of
-- rows, or if this was opened accidentally.
COMMIT;
