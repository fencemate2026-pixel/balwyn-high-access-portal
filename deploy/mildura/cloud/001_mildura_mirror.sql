-- STAGED, NOT APPLIED. Mildura read-only mirror (Phase 1). Needs Jarrod's approval before running.
-- Additive only: new tables + one site row + one unit row. Touches no existing gd_* rows or policies.
-- Rollback: see 001_mildura_mirror_rollback.sql.
-- Mirror tables hold names and history only. There is no PIN column anywhere.

create table if not exists public.gd_mirror_users (
  site_id uuid not null references public.gd_sites(id) on delete cascade,
  local_id bigint not null,
  name text not null,
  enabled boolean not null default true,
  schedule_type text,
  schedule_data text,
  created_at_local text,
  synced_at timestamptz not null default now(),
  primary key (site_id, local_id)
);
create table if not exists public.gd_mirror_schedules (
  site_id uuid not null references public.gd_sites(id) on delete cascade,
  local_id bigint not null,
  name text, days text, open_time text, close_time text,
  enabled boolean not null default true,
  synced_at timestamptz not null default now(),
  primary key (site_id, local_id)
);
create table if not exists public.gd_mirror_persons (
  site_id uuid not null references public.gd_sites(id) on delete cascade,
  local_id bigint not null,
  name text, role text,
  synced_at timestamptz not null default now(),
  primary key (site_id, local_id)
);
create table if not exists public.gd_mirror_access (
  site_id uuid not null references public.gd_sites(id) on delete cascade,
  local_id bigint not null,
  occurred_at_local text,
  user_name text, method text, success boolean,
  received_at timestamptz not null default now(),
  primary key (site_id, local_id)
);
create table if not exists public.gd_mirror_changes (
  site_id uuid not null references public.gd_sites(id) on delete cascade,
  local_id bigint not null,
  occurred_at_local text,
  action text, detail text, changed_by text,
  received_at timestamptz not null default now(),
  primary key (site_id, local_id)
);

-- Same access model as the other gd_* tables: RLS on, only gd_admins read. Writes happen only
-- through the gd-mirror edge function using the service role (which bypasses RLS).
do $$ declare t text; begin
  foreach t in array array['gd_mirror_users','gd_mirror_schedules','gd_mirror_persons','gd_mirror_access','gd_mirror_changes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t||'_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.gd_admins a where a.user_id = (select auth.uid())))', t||'_admin_read', t);
  end loop;
end $$;

create index if not exists gd_mirror_access_site_time on public.gd_mirror_access(site_id, local_id desc);
create index if not exists gd_mirror_changes_site_time on public.gd_mirror_changes(site_id, local_id desc);

-- Mildura as a site + one unit (boom gate). secret_hash is set separately by the install step
-- (sha256 of the device secret, generated on the Pi side); it is NOT in this file.
insert into public.gd_sites(slug, name, timezone)
values ('mildura', 'Mildura Working Men''s Club', 'Australia/Melbourne')
on conflict (slug) do nothing;
