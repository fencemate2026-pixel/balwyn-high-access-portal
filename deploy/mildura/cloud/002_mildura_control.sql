-- STAGED, NOT APPLIED. Mildura Phase 2: portal -> Pi command queue. Needs Jarrod's approval.
-- Requires 001_mildura_mirror.sql. Additive only; touches no Thomastown rows, policies or triggers.
-- Rollback: 002_mildura_control_rollback.sql.
--
-- PIN rule: a PIN (and an authorised person's phone) is NEVER stored in plaintext. The portal server
-- encrypts it to the Pi's own RSA-OAEP public key before insert (column `sealed`); the private key
-- exists only on the Pi. `sealed` is wiped (set null) the moment a command is acked, fails or expires,
-- and constraints below make it impossible to keep ciphertext on a finished row or to put a
-- plaintext pin/phone into `args`.

-- The Pi uploads only its PUBLIC key (first write wins; rotate by nulling it here, then restart the service).
alter table public.gd_units add column if not exists command_pubkey text;
alter table public.gd_units add column if not exists command_pubkey_at timestamptz;

create table if not exists public.gd_mirror_commands (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.gd_sites(id) on delete cascade,
  unit_id uuid not null references public.gd_units(id) on delete cascade,
  seq bigserial not null,
  client_key uuid not null,                       -- double-click / retry guard from the browser
  kind text not null check (kind in (
    'user.add','user.update','user.delete','user.enable','users.enable_all',
    'schedule.add','schedule.enable','schedule.delete','person.add','person.delete',
    'gate.open','gate.lockdown')),                 -- Hold Open is retired in the gate app (time clock owns it)
  args jsonb not null default '{}'::jsonb,
  sealed text,                                    -- base64 RSA-OAEP ciphertext of {"pin","phone","cmd"}; never plaintext
  status text not null default 'pending' check (status in ('pending','delivered','applied','failed','expired')),
  actor_email text not null,
  attempts int not null default 0,
  error text,
  result jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  constraint gd_mirror_commands_no_plain_secret check (not (args ?| array['pin','phone','PIN','Pin'])),
  constraint gd_mirror_commands_sealed_only_while_open check (sealed is null or status in ('pending','delivered')),
  constraint gd_mirror_commands_sealed_size check (sealed is null or length(sealed) between 16 and 2048),
  unique (unit_id, client_key)
);
create index if not exists gd_mirror_commands_open on public.gd_mirror_commands(unit_id, seq) where status in ('pending','delivered');
create index if not exists gd_mirror_commands_site_time on public.gd_mirror_commands(site_id, created_at desc);

-- No browser/role access at all: only the owner-gated portal server and the gd-mirror function
-- (both service role, which bypasses RLS) touch this table.
alter table public.gd_mirror_commands enable row level security;
revoke all on public.gd_mirror_commands from anon, authenticated;

-- Belt and braces: whatever path finishes a command, the ciphertext goes with it.
create or replace function public.gd_mirror_commands_wipe() returns trigger language plpgsql as $$
begin
  if new.status not in ('pending','delivered') then new.sealed := null; end if;
  return new;
end $$;
drop trigger if exists gd_mirror_commands_wipe on public.gd_mirror_commands;
create trigger gd_mirror_commands_wipe before insert or update on public.gd_mirror_commands
  for each row execute function public.gd_mirror_commands_wipe();

-- Portal-side audit rows live alongside the Pi's own changes_log mirror. Pi rows always carry the Pi's
-- positive local id; portal rows omit it and get a negative id from this sequence, so they never collide.
create sequence if not exists public.gd_mirror_portal_audit_seq;
alter table public.gd_mirror_changes add column if not exists source text not null default 'pi';
alter table public.gd_mirror_changes alter column local_id set default (-nextval('public.gd_mirror_portal_audit_seq'));
