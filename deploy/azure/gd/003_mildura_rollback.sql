-- Rollback for 003_mildura.sql. Removes only the Mildura tables and device row; Thomastown data is untouched.
DROP TABLE IF EXISTS gd.mildura_commands, gd.mildura_access_pins, gd.mildura_access, gd.mildura_changes,
  gd.mildura_users, gd.mildura_schedules, gd.mildura_persons CASCADE;
DROP FUNCTION IF EXISTS gd.mildura_commands_wipe();
DROP SEQUENCE IF EXISTS gd.mildura_portal_audit_seq;
DELETE FROM gd.devices WHERE device_id = 'mildura-001';
ALTER TABLE gd.devices DROP COLUMN IF EXISTS secret_sha256, DROP COLUMN IF EXISTS command_pubkey, DROP COLUMN IF EXISTS command_pubkey_at;
