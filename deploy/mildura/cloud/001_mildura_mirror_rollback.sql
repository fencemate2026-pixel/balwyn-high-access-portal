-- Removes everything 001_mildura_mirror.sql added. Leaves Thomastown and all other gd_* data alone.
drop table if exists public.gd_mirror_changes, public.gd_mirror_access, public.gd_mirror_persons,
  public.gd_mirror_schedules, public.gd_mirror_users;
delete from public.gd_units where device_id = 'mildura-001';
delete from public.gd_sites where slug = 'mildura';
