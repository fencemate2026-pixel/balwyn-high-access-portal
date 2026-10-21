-- Leftover IDs from an old Balwyn gate register. The live Magic Keys model
-- only lists nine access points (see lib/portal-model.ts). These 15 records
-- must not appear as commissioned hardware.
--
-- Review before running against production. Local safety circuits and the
-- current nine-gate register stay authoritative.

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
