-- 24 Oct 2026 (Jarrod): each day of a gate's weekly schedule can carry a name
-- ("School drop-off", "Sport carnival") as well as its times. Display only: the
-- name is never part of the window key, so renaming a running window does not
-- re-open a gate staff have closed.
ALTER TABLE balwyn_portal.gate_schedules ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT '';
