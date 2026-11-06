-- 6 Nov 2026, owner request: show the code actually entered for each access event.
-- Keep it separate from gd_mirror_access, which other gd_admins can read.
create table if not exists public.gd_mirror_access_pins (
  site_id uuid not null,
  local_id bigint not null,
  attempted_pin text not null check (attempted_pin ~ '^[0-9]{1,16}$'),
  received_at timestamptz not null default now(),
  primary key (site_id, local_id),
  foreign key (site_id, local_id) references public.gd_mirror_access(site_id, local_id) on delete cascade
);
alter table public.gd_mirror_access_pins enable row level security;
revoke all on public.gd_mirror_access_pins from public, anon, authenticated;
grant select, insert, update, delete on public.gd_mirror_access_pins to service_role;
comment on table public.gd_mirror_access_pins is
  'Actual recorded access-event PINs. Read only via the owner-gated portal server; no browser-role access.';
