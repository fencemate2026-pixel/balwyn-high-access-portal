-- Adds the Settlement Road swing gate as its own device. The device id is settlement-road-swing.
-- There is no dial-in number: that SIM is not activated. Re-running is harmless.
-- Callers are not in this file. They are loaded into gd.users for this device from the unit
-- that moved to Macquarie Drive, then removed from that unit.
-- Rollback: 007_settlement_road_swing_rollback.sql.
INSERT INTO gd.devices(device_id, site_name)
VALUES ('settlement-road-swing', 'Settlement Road Swing Gate')
ON CONFLICT (device_id) DO NOTHING;
