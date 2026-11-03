-- Removes everything 002_mildura_control.sql added. Phase 1 mirror tables and Thomastown are untouched.
-- Run AFTER setting MIRROR_CONTROL=0 on the Pi (or the Pi just logs "commands unavailable" and keeps mirroring).
drop table if exists public.gd_mirror_commands;
drop function if exists public.gd_mirror_commands_wipe();
delete from public.gd_mirror_changes where source = 'portal';
alter table public.gd_mirror_changes alter column local_id drop default;
alter table public.gd_mirror_changes drop column if exists source;
drop sequence if exists public.gd_mirror_portal_audit_seq;
alter table public.gd_units drop column if exists command_pubkey_at;
alter table public.gd_units drop column if exists command_pubkey;
