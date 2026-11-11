-- STAGED, NOT APPLIED. Lets the Macquarie Drive Thomastown owner queue one relay pulse (command kind gate.pulse).
-- Run as the Azure PostgreSQL administrator, AFTER 001. Additive: only widens the CHECK on gd.commands.kind.
-- Re-runnable. Rollback: 007_gate_pulse_rollback.sql. The portal does not pulse the relay. The Pi does, once, when it collects the command.

ALTER TABLE gd.commands DROP CONSTRAINT IF EXISTS commands_kind_check;
ALTER TABLE gd.commands ADD CONSTRAINT commands_kind_check CHECK (kind IN
  ('user.add','user.update','user.delete','user.enable','hold.add','hold.update','hold.delete','hold.enable','sim.number','gate.pulse'));
