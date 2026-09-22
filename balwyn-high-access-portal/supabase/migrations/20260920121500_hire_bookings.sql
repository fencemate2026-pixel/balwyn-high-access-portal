-- ============================================================================
-- Facility hire for Balwyn High School — after-hours and weekend use of the
-- sports stadium and grounds.
--
-- Prefix: hire_   (avoids the existing mtn_ and gate_ tables in this project)
-- Times:  stored as timestamptz; displayed in Australia/Melbourne, matching
--         the portal's existing schedule handling.
-- Money:  numeric(12,2) — exact. Never a float for currency.
-- RLS:    enabled and deny-by-default on every table, matching the convention
--         already used by every other table in this project. Reach these only
--         from the server with the service role key, never from a browser.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- clients ---
-- One row per hirer. Kept so a returning client is selected, not retyped.
create table if not exists public.hire_clients (
  id              uuid primary key default gen_random_uuid(),
  full_name       text        not null check (length(btrim(full_name)) between 1 and 120),
  email           text        check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone           text        check (phone is null or length(btrim(phone)) between 6 and 40),
  organisation    text        check (organisation is null or length(organisation) <= 160),
  archived        boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      text        not null default 'system'
);

comment on table public.hire_clients is
  'People and groups who hire the school grounds after hours. Personal information — see the portal privacy policy.';

create unique index if not exists hire_clients_email_key
  on public.hire_clients (lower(email)) where email is not null and archived = false;
create index if not exists hire_clients_name_idx
  on public.hire_clients (lower(full_name));

-- ------------------------------------------------------------------ areas ---
-- The parts of the school that can be hired. A lookup table so the list is
-- managed in the app rather than hardcoded in a dropdown.
create table if not exists public.hire_areas (
  key         text primary key check (key ~ '^[a-z0-9-]{2,40}$'),
  label       text not null,
  active      boolean not null default true,
  sort_order  integer not null default 100
);

insert into public.hire_areas (key, label, sort_order) values
  ('tony-frizza-stadium', 'Tony Frizza Stadium',   10),
  ('oval',                'Oval and grounds',      20),
  ('tennis-courts',       'Tennis courts',         30),
  ('gymnasium',           'Gymnasium',             40),
  ('car-park',            'Car park',              50)
on conflict (key) do nothing;

-- --------------------------------------------------------------- bookings ---
-- The agreement. One row per hire arrangement, recurring or one-off.
create type hire_recurrence as enum ('one_off', 'weekly');
create type hire_status     as enum ('enquiry', 'confirmed', 'cancelled', 'completed');
create type hire_deposit    as enum ('not_required', 'invoiced', 'held', 'refunded', 'forfeited');

create table if not exists public.hire_bookings (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.hire_clients(id) on delete restrict,

  -- The name that appears on the schedule, e.g. "Balwyn Basketball — Saturday".
  name               text not null check (length(btrim(name)) between 1 and 120),

  recurrence         hire_recurrence not null default 'one_off',
  -- weekly only: 0 = Sunday .. 6 = Saturday, matching JS getDay().
  day_of_week        smallint check (day_of_week between 0 and 6),
  -- weekly only: the term or season the arrangement runs for.
  season_start       date,
  season_end         date,
  -- one_off only.
  booking_date       date,

  start_time         time not null,
  end_time           time not null,

  status             hire_status not null default 'enquiry',

  charge_amount      numeric(12,2) not null default 0 check (charge_amount >= 0),
  charge_currency    char(3)       not null default 'AUD',
  charge_note        text,

  deposit_status     hire_deposit  not null default 'not_required',
  deposit_amount     numeric(12,2) not null default 0 check (deposit_amount >= 0),

  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         text not null default 'system',

  -- The hire must occupy real time on the day.
  constraint hire_bookings_times_ordered check (end_time > start_time),

  -- A deposit amount only means something when a deposit is actually required.
  constraint hire_bookings_deposit_coherent check (
    (deposit_status = 'not_required' and deposit_amount = 0)
    or (deposit_status <> 'not_required' and deposit_amount > 0)
  ),

  -- Each recurrence kind needs its own fields, and must not carry the other's.
  constraint hire_bookings_shape check (
    (recurrence = 'one_off'
       and booking_date is not null
       and day_of_week is null and season_start is null and season_end is null)
    or
    (recurrence = 'weekly'
       and booking_date is null
       and day_of_week is not null
       and season_start is not null and season_end is not null
       and season_end >= season_start)
  )
);

comment on column public.hire_bookings.name is
  'Schedule name shown to staff, e.g. "Balwyn Basketball - Saturday".';

create index if not exists hire_bookings_client_idx on public.hire_bookings (client_id);
create index if not exists hire_bookings_status_idx on public.hire_bookings (status)
  where status in ('enquiry','confirmed');

-- Which areas each booking covers.
create table if not exists public.hire_booking_areas (
  booking_id uuid not null references public.hire_bookings(id) on delete cascade,
  area_key   text not null references public.hire_areas(key)  on delete restrict,
  primary key (booking_id, area_key)
);

-- ------------------------------------------------------------ occurrences ---
-- One row per actual dated visit. This is what the dashboard reads to answer
-- "who is coming, when, and for how long". A one-off booking has exactly one;
-- a weekly booking has one per week across its season.
create table if not exists public.hire_booking_occurrences (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references public.hire_bookings(id) on delete cascade,
  occurs_on        date not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  -- How long they are on site. Generated, so it can never disagree with the
  -- times it is derived from.
  duration_minutes integer generated always as
                     (floor(extract(epoch from (ends_at - starts_at)) / 60)::integer) stored,
  cancelled        boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint hire_occurrence_times_ordered check (ends_at > starts_at),
  unique (booking_id, occurs_on)
);

create index if not exists hire_occurrences_when_idx
  on public.hire_booking_occurrences (starts_at) where cancelled = false;

-- --------------------------------------------------------------- comments ---
-- Stays with the client, not the booking, so history follows a returning hirer.
-- booking_id is optional: a comment can be about one visit or about the client
-- generally.
create type hire_condition as enum ('clean', 'acceptable', 'dirty', 'damage');

create table if not exists public.hire_comments (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.hire_clients(id) on delete cascade,
  booking_id  uuid references public.hire_bookings(id) on delete set null,
  condition   hire_condition,
  body        text not null check (length(btrim(body)) between 1 and 4000),
  author      text not null default 'system',
  created_at  timestamptz not null default now()
);

create index if not exists hire_comments_client_idx
  on public.hire_comments (client_id, created_at desc);

-- ---------------------------------------------------------- updated_at ------
create or replace function public.hire_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger hire_clients_touch  before update on public.hire_clients
  for each row execute function public.hire_touch_updated_at();
create trigger hire_bookings_touch before update on public.hire_bookings
  for each row execute function public.hire_touch_updated_at();

-- ------------------------------------------------------- dashboard view -----
-- What staff see: who is coming, when, for how long, and where.
create or replace view public.hire_schedule_view as
select
  o.id                as occurrence_id,
  b.id                as booking_id,
  b.name              as schedule_name,
  c.id                as client_id,
  c.full_name,
  c.organisation,
  c.email,
  c.phone,
  o.occurs_on,
  o.starts_at,
  o.ends_at,
  o.duration_minutes,
  round(o.duration_minutes / 60.0, 2) as duration_hours,
  b.recurrence,
  b.status,
  b.charge_amount,
  b.charge_currency,
  b.deposit_status,
  b.deposit_amount,
  coalesce(
    (select array_agg(a.label order by a.sort_order)
       from public.hire_booking_areas ba
       join public.hire_areas a on a.key = ba.area_key
      where ba.booking_id = b.id),
    array[]::text[]
  ) as areas
from public.hire_booking_occurrences o
join public.hire_bookings b on b.id = o.booking_id
join public.hire_clients  c on c.id = b.client_id
where o.cancelled = false
  and b.status in ('confirmed','completed');

comment on view public.hire_schedule_view is
  'Dashboard and printed run sheet: confirmed visits with client, times, duration and areas.';

-- ------------------------------------------------------------------ RLS -----
-- Deny by default. No policies are created, so the anon and authenticated
-- roles can read nothing. The portal reaches these tables server-side with the
-- service role key, which bypasses RLS. Never expose that key to a browser.
alter table public.hire_clients             enable row level security;
alter table public.hire_areas               enable row level security;
alter table public.hire_bookings            enable row level security;
alter table public.hire_booking_areas       enable row level security;
alter table public.hire_booking_occurrences enable row level security;
alter table public.hire_comments            enable row level security;

revoke all on public.hire_schedule_view from anon, authenticated;
