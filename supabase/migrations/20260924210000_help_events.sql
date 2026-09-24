-- Help-desk learning log. Questions only. No emails, tokens, or gate commands.
CREATE TABLE IF NOT EXISTS balwyn_portal.help_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  actor_role   text NOT NULL CHECK (actor_role IN ('viewer', 'operator', 'administrator')),
  page         text NOT NULL CHECK (char_length(page) BETWEEN 1 AND 40),
  question     text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 1500),
  status       text NOT NULL CHECK (status IN ('answered', 'not_connected', 'unavailable', 'no_match', 'error')),
  mode         text NOT NULL CHECK (mode IN ('ai', 'knowledge', 'error')),
  article_id   text,
  issue        text
);

CREATE INDEX IF NOT EXISTS idx_help_events_created ON balwyn_portal.help_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_help_events_status ON balwyn_portal.help_events (status, created_at DESC);

ALTER TABLE balwyn_portal.help_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS balwyn_server_access ON balwyn_portal.help_events;
CREATE POLICY balwyn_server_access ON balwyn_portal.help_events TO balwyn_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON balwyn_portal.help_events TO balwyn_app;
