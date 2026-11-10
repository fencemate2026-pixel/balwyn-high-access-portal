-- Rename the existing swing-gate row. The device id stays thomastown-swing, so the Pi
-- keeps the same portal address and HMAC secret. Callers, call logs and queued
-- commands are not touched. Re-running is harmless. Rollback: 006_macquarie_drive_name_rollback.sql.
-- The owner screen title comes from the portal code (SWING_SITE_NAME). This row is the
-- stored name in Azure. 001 inserts the new name only when the row does not exist yet.
UPDATE gd.devices
SET site_name = 'Macquarie Drive Thomastown'
WHERE device_id = 'thomastown-swing'
  AND site_name IS DISTINCT FROM 'Macquarie Drive Thomastown';
