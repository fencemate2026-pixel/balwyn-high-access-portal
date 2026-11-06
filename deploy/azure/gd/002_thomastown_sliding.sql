-- STAGED, NOT APPLIED. Adds the Thomastown SLIDING gate as a second device in the existing gd schema.
-- Run once as the Azure PostgreSQL administrator, AFTER 001_thomastown_swing.sql. Re-running is harmless.
-- Additive: one device row. No new table, role or grant (gd_app already covers the schema).
-- The device HMAC secret is NOT stored here; it lives in the App Service setting
-- GD_THOMASTOWN_SLIDING_SECRET and in the sliding Pi's /etc/thomgate-portal-sync.env (mode 0600).
INSERT INTO gd.devices(device_id, site_name)
VALUES ('thomastown-sliding', 'Thomastown Body Corp - sliding gate')
ON CONFLICT (device_id) DO NOTHING;
