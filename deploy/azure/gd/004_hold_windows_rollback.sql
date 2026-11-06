-- Removes the hold-window mirror and puts the original four command kinds back.
-- Open hold.* commands are deleted first (the old CHECK would refuse them). Nothing on any Pi is changed.
DELETE FROM gd.commands WHERE kind LIKE 'hold.%';
DROP TABLE IF EXISTS gd.hold_windows;
ALTER TABLE gd.commands DROP CONSTRAINT IF EXISTS commands_kind_check;
ALTER TABLE gd.commands ADD CONSTRAINT commands_kind_check CHECK (kind IN ('user.add','user.update','user.delete','user.enable'));
