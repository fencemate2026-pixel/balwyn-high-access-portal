-- Removes ONLY the Settlement Road swing gate: its device row and, by cascade, its callers,
-- call log, change log, queued commands and replay nonces. Macquarie Drive, the sliding gate
-- and the school schema are not touched.
DELETE FROM gd.devices WHERE device_id = 'settlement-road-swing';
DELETE FROM gd.device_nonces WHERE device_id = 'settlement-road-swing';
