-- ============================================================================
-- Profile photos in the portal database (6 Nov 2026).
--
-- Used when the portal runs on its own PostgreSQL (PORTAL_DATABASE_URL), where
-- there is no Supabase Storage. Photos are at most 3 MB, so they are held as
-- base64 text (the database request guard passes text parameters only).
-- The Supabase Storage bucket keeps working for the Supabase deployment.
-- ============================================================================
CREATE TABLE IF NOT EXISTS balwyn_portal.profile_photos (
  key           text PRIMARY KEY CHECK (key ~ '^profiles/[a-zA-Z0-9-]+/[a-zA-Z0-9-]+$'),
  content_type  text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data_base64   text NOT NULL CHECK (length(data_base64) <= 4300000),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE balwyn_portal.profile_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.profile_photos;
CREATE POLICY balwyn_server_access ON balwyn_portal.profile_photos TO balwyn_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON balwyn_portal.profile_photos TO balwyn_app;
