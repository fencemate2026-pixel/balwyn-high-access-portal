-- ============================================================================
-- Macquarie Drive Thomastown resident portal (11 Nov 2026).
--
-- Separate from portal_accounts so a resident is never an operator.
-- Sign-in is a 6-digit code emailed to an address on macquarie_portal_users.
-- The code is stored as a hash. The seed address cannot be removed.
-- ============================================================================
CREATE TABLE IF NOT EXISTS balwyn_portal.macquarie_portal_users (
  email         text PRIMARY KEY CHECK (
                  email = lower(email)
                  AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                  AND length(email) <= 254
                ),
  display_name  text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
  kept          boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT macquarie_seed_kept CHECK (email <> 'info@rjlcommercialgroup.com' OR kept)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_macquarie_portal_users_email
  ON balwyn_portal.macquarie_portal_users (lower(email));

CREATE TABLE IF NOT EXISTS balwyn_portal.macquarie_login_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  code_hash   text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_macquarie_login_codes_email
  ON balwyn_portal.macquarie_login_codes (lower(email), created_at DESC);

ALTER TABLE balwyn_portal.macquarie_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE balwyn_portal.macquarie_login_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.macquarie_portal_users;
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.macquarie_login_codes;
CREATE POLICY balwyn_server_access ON balwyn_portal.macquarie_portal_users TO balwyn_app USING (true) WITH CHECK (true);
CREATE POLICY balwyn_server_access ON balwyn_portal.macquarie_login_codes TO balwyn_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON balwyn_portal.macquarie_portal_users TO balwyn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON balwyn_portal.macquarie_login_codes TO balwyn_app;

INSERT INTO balwyn_portal.macquarie_portal_users (email, display_name, kept)
SELECT 'info@rjlcommercialgroup.com', 'Jarrod Alebakis', true
WHERE NOT EXISTS (
  SELECT 1 FROM balwyn_portal.macquarie_portal_users WHERE lower(email) = 'info@rjlcommercialgroup.com'
);
