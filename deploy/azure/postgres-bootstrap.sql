-- Run ONCE, as the Azure PostgreSQL administrator, on the new empty database,
-- BEFORE the migrations in supabase/migrations/ (run those in filename order).
--
-- The migrations were written for Supabase and refer to three things that plain
-- PostgreSQL does not have: the roles anon / authenticated / postgres and the
-- storage schema. These empty stand-ins let the migrations run unchanged. They
-- hold no data and grant nothing; the portal never uses them.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);

-- After the migrations have run, let the connection user switch to the portal's
-- restricted role (the portal does SET LOCAL ROLE balwyn_app on every request).
-- Replace portaladmin with the administrator login name you created in Azure.
-- GRANT balwyn_app TO portaladmin;
