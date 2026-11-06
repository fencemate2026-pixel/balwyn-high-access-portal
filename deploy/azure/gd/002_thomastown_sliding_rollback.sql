-- Removes ONLY the Thomastown sliding gate: its device row and, by cascade, its mirrored callers, call
-- log, change log, queued commands and replay nonces in schema gd. The swing gate and the school
-- schema are not touched. Nothing on the Pi is changed (the Pi's database is the authority).
DELETE FROM gd.devices WHERE device_id = 'thomastown-sliding';
DELETE FROM gd.device_nonces WHERE device_id = 'thomastown-sliding';
