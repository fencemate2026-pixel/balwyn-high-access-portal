-- Facility hire — after-hours and weekend use of the stadium and grounds.
-- Targets schema balwyn_portal, NOT public.

CREATE TABLE IF NOT EXISTS balwyn_portal.hire_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
  email         text CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone         text CHECK (phone IS NULL OR length(btrim(phone)) BETWEEN 6 AND 40),
  organisation  text CHECK (organisation IS NULL OR length(organisation) <= 160),
  archived      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL DEFAULT 'system'
);

COMMENT ON TABLE balwyn_portal.hire_clients IS
  'People and groups who hire the school grounds. Personal information about members of the public — covered by the portal privacy policy.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_hire_clients_email
  ON balwyn_portal.hire_clients (lower(email)) WHERE email IS NOT NULL AND archived = false;
CREATE INDEX IF NOT EXISTS idx_hire_clients_name
  ON balwyn_portal.hire_clients (lower(full_name));

CREATE TABLE IF NOT EXISTS balwyn_portal.hire_areas (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z0-9-]{2,40}$'),
  label       text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 100
);

INSERT INTO balwyn_portal.hire_areas (key, label, sort_order) VALUES
  ('tony-frizza-stadium', 'Tony Frizza Stadium', 10),
  ('oval',                'Oval and grounds',    20),
  ('tennis-courts',       'Tennis courts',       30),
  ('gymnasium',           'Gymnasium',           40),
  ('car-park',            'Car park',            50)
ON CONFLICT (key) DO NOTHING;

DO $$ BEGIN
  CREATE TYPE balwyn_portal.hire_recurrence AS ENUM ('one_off', 'weekly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE balwyn_portal.hire_status AS ENUM ('enquiry', 'confirmed', 'cancelled', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE balwyn_portal.hire_deposit AS ENUM ('not_required', 'invoiced', 'held', 'refunded', 'forfeited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE balwyn_portal.hire_condition AS ENUM ('clean', 'acceptable', 'dirty', 'damage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS balwyn_portal.hire_bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES balwyn_portal.hire_clients(id) ON DELETE RESTRICT,
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  recurrence       balwyn_portal.hire_recurrence NOT NULL DEFAULT 'one_off',
  day_of_week      smallint CHECK (day_of_week BETWEEN 0 AND 6),
  season_start     date,
  season_end       date,
  booking_date     date,
  start_time       time NOT NULL,
  end_time         time NOT NULL,
  status           balwyn_portal.hire_status NOT NULL DEFAULT 'enquiry',
  charge_amount    numeric(12,2) NOT NULL DEFAULT 0 CHECK (charge_amount >= 0),
  charge_currency  char(3) NOT NULL DEFAULT 'AUD',
  charge_note      text,
  deposit_status   balwyn_portal.hire_deposit NOT NULL DEFAULT 'not_required',
  deposit_amount   numeric(12,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL DEFAULT 'system',
  CONSTRAINT hire_bookings_times_ordered CHECK (end_time > start_time),
  CONSTRAINT hire_bookings_deposit_coherent CHECK (
    (deposit_status = 'not_required' AND deposit_amount = 0)
    OR (deposit_status <> 'not_required' AND deposit_amount > 0)
  ),
  CONSTRAINT hire_bookings_shape CHECK (
    (recurrence = 'one_off'
       AND booking_date IS NOT NULL
       AND day_of_week IS NULL AND season_start IS NULL AND season_end IS NULL)
    OR
    (recurrence = 'weekly'
       AND booking_date IS NULL
       AND day_of_week IS NOT NULL
       AND season_start IS NOT NULL AND season_end IS NOT NULL
       AND season_end >= season_start)
  )
);

CREATE INDEX IF NOT EXISTS idx_hire_bookings_client ON balwyn_portal.hire_bookings (client_id);
CREATE INDEX IF NOT EXISTS idx_hire_bookings_status ON balwyn_portal.hire_bookings (status)
  WHERE status IN ('enquiry','confirmed');

CREATE TABLE IF NOT EXISTS balwyn_portal.hire_booking_areas (
  booking_id uuid NOT NULL REFERENCES balwyn_portal.hire_bookings(id) ON DELETE CASCADE,
  area_key   text NOT NULL REFERENCES balwyn_portal.hire_areas(key) ON DELETE RESTRICT,
  PRIMARY KEY (booking_id, area_key)
);

CREATE TABLE IF NOT EXISTS balwyn_portal.hire_booking_occurrences (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES balwyn_portal.hire_bookings(id) ON DELETE CASCADE,
  occurs_on        date NOT NULL,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  duration_minutes integer GENERATED ALWAYS AS
                     (floor(extract(epoch FROM (ends_at - starts_at)) / 60)::integer) STORED,
  cancelled        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hire_occurrence_times_ordered CHECK (ends_at > starts_at),
  UNIQUE (booking_id, occurs_on)
);

CREATE INDEX IF NOT EXISTS idx_hire_occurrences_when
  ON balwyn_portal.hire_booking_occurrences (starts_at) WHERE cancelled = false;

CREATE TABLE IF NOT EXISTS balwyn_portal.hire_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES balwyn_portal.hire_clients(id) ON DELETE CASCADE,
  booking_id  uuid REFERENCES balwyn_portal.hire_bookings(id) ON DELETE SET NULL,
  condition   balwyn_portal.hire_condition,
  body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  author      text NOT NULL DEFAULT 'system',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hire_comments_client
  ON balwyn_portal.hire_comments (client_id, created_at DESC);

CREATE OR REPLACE FUNCTION balwyn_portal.hire_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hire_clients_touch ON balwyn_portal.hire_clients;
CREATE TRIGGER hire_clients_touch BEFORE UPDATE ON balwyn_portal.hire_clients
  FOR EACH ROW EXECUTE FUNCTION balwyn_portal.hire_touch_updated_at();

DROP TRIGGER IF EXISTS hire_bookings_touch ON balwyn_portal.hire_bookings;
CREATE TRIGGER hire_bookings_touch BEFORE UPDATE ON balwyn_portal.hire_bookings
  FOR EACH ROW EXECUTE FUNCTION balwyn_portal.hire_touch_updated_at();

CREATE OR REPLACE VIEW balwyn_portal.hire_schedule_view AS
SELECT
  o.id AS occurrence_id,
  b.id AS booking_id,
  b.name AS schedule_name,
  c.id AS client_id,
  c.full_name,
  c.organisation,
  c.email,
  c.phone,
  o.occurs_on,
  o.starts_at,
  o.ends_at,
  o.duration_minutes,
  round(o.duration_minutes / 60.0, 2) AS duration_hours,
  b.recurrence,
  b.status,
  b.charge_amount,
  b.charge_currency,
  b.deposit_status,
  b.deposit_amount,
  COALESCE(
    (SELECT array_agg(a.label ORDER BY a.sort_order)
       FROM balwyn_portal.hire_booking_areas ba
       JOIN balwyn_portal.hire_areas a ON a.key = ba.area_key
      WHERE ba.booking_id = b.id),
    ARRAY[]::text[]
  ) AS areas
FROM balwyn_portal.hire_booking_occurrences o
JOIN balwyn_portal.hire_bookings b ON b.id = o.booking_id
JOIN balwyn_portal.hire_clients  c ON c.id = b.client_id
WHERE o.cancelled = false
  AND b.status IN ('confirmed','completed');

ALTER TABLE balwyn_portal.hire_clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE balwyn_portal.hire_areas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE balwyn_portal.hire_bookings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE balwyn_portal.hire_booking_areas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE balwyn_portal.hire_booking_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE balwyn_portal.hire_comments            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.hire_clients;
CREATE POLICY balwyn_server_access ON balwyn_portal.hire_clients             TO balwyn_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.hire_areas;
CREATE POLICY balwyn_server_access ON balwyn_portal.hire_areas               TO balwyn_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.hire_bookings;
CREATE POLICY balwyn_server_access ON balwyn_portal.hire_bookings            TO balwyn_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.hire_booking_areas;
CREATE POLICY balwyn_server_access ON balwyn_portal.hire_booking_areas       TO balwyn_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.hire_booking_occurrences;
CREATE POLICY balwyn_server_access ON balwyn_portal.hire_booking_occurrences TO balwyn_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.hire_comments;
CREATE POLICY balwyn_server_access ON balwyn_portal.hire_comments            TO balwyn_app USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA balwyn_portal TO balwyn_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA balwyn_portal TO balwyn_app;
GRANT SELECT ON balwyn_portal.hire_schedule_view TO balwyn_app;
