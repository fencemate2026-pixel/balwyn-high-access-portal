-- Puts the swing device label back. Does not restore or delete callers.
UPDATE gd.devices
SET site_name = 'Thomastown Body Corp - double swing gate'
WHERE device_id = 'thomastown-swing';
