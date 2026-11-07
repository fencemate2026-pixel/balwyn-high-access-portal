-- Puts the command kinds back to the set from 004. Queued sim.number commands are deleted first (the old CHECK would refuse them).
-- Nothing on any Pi is changed.
DELETE FROM gd.commands WHERE kind = 'sim.number';
ALTER TABLE gd.commands DROP CONSTRAINT IF EXISTS commands_kind_check;
ALTER TABLE gd.commands ADD CONSTRAINT commands_kind_check CHECK (kind IN
  ('user.add','user.update','user.delete','user.enable','hold.add','hold.update','hold.delete','hold.enable'));
