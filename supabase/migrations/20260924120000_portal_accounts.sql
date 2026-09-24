-- ============================================================================
-- Per-person email + password accounts (24 Sep 2026).
--
-- Created by an administrator in Access & users. The person sets their own
-- password through a one-time setup link (72 h). No password is ever emailed
-- or shown to the administrator. Operators and administrators must also pass
-- the 6-digit authenticator step; viewers sign in with the password alone.
--
-- password_hash uses the portal's three-stage PBKDF2 format. setup_token_hash
-- is a SHA-256 of the one-time token; the token itself is never stored.
-- password_version increments on every password set/reset so existing
-- sessions and pending authenticator challenges for that account die.
-- ============================================================================
CREATE TABLE IF NOT EXISTS balwyn_portal.portal_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' AND length(email) <= 254),
  display_name      text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  role              text NOT NULL CHECK (role IN ('viewer', 'operator', 'administrator')),
  password_salt     text,
  password_hash     text,
  password_version  integer NOT NULL DEFAULT 0,
  setup_token_hash  text,
  setup_expires_at  timestamptz,
  active            boolean NOT NULL DEFAULT true,
  last_sign_in_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL DEFAULT 'system',
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_accounts_password_pair CHECK ((password_salt IS NULL) = (password_hash IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_email ON balwyn_portal.portal_accounts (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_setup ON balwyn_portal.portal_accounts (setup_token_hash) WHERE setup_token_hash IS NOT NULL;

ALTER TABLE balwyn_portal.portal_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.portal_accounts;
CREATE POLICY balwyn_server_access ON balwyn_portal.portal_accounts TO balwyn_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON balwyn_portal.portal_accounts TO balwyn_app;
