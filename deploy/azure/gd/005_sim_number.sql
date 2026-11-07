-- STAGED, NOT APPLIED. Lets the owner save the gate SIM's dial-in number from the portal (command kind sim.number).
-- Run as the Azure PostgreSQL administrator, AFTER 001 and 004. Additive: only widens the CHECK on gd.commands.kind.
-- Re-runnable. Rollback: 005_sim_number_rollback.sql. The SIM itself is read by the Pi; nothing is stored here
-- except the queued command (the number then comes back through the heartbeat in gd.devices.last_status).

ALTER TABLE gd.commands DROP CONSTRAINT IF EXISTS commands_kind_check;
ALTER TABLE gd.commands ADD CONSTRAINT commands_kind_check CHECK (kind IN
  ('user.add','user.update','user.delete','user.enable','hold.add','hold.update','hold.delete','hold.enable','sim.number'));
