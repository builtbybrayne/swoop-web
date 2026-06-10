-- 016_puma_session.sql — B.t13: Postgres-backed durable sessions
--
-- Two tables owned by @swoop/orchestrator (prefix marks ownership):
--   puma_session       — the Puma SessionState (consent, triage, wishlist, etc.)
--   puma_session_event — append-only ADK event log (what runner.sessionService persists)
--
-- puma_session_event is append-only rather than a fat JSONB blob because:
--   1. Concurrent appends from multiple streamed tool-call events never clobber.
--   2. History projection iterates ordered rows — no JSON array manipulation.
--   3. Sweep/archival touches puma_session only; events cascade on DELETE.
--
-- TTL sweep is handled by a SQL function called from the orchestrator's in-process
-- interval (E.t6 carrier pattern). archived_at NULL = active; non-NULL = archived.
-- Sweeper: idle past SESSION_TTL_IDLE_HOURS → archived; archived past
-- SESSION_TTL_ARCHIVE_DAYS → deleted (CASCADE deletes events).

CREATE TABLE IF NOT EXISTS puma_session (
  id              TEXT        PRIMARY KEY,
  state           JSONB       NOT NULL DEFAULT '{}',
  adk_state       JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS puma_session_last_active_at_idx
  ON puma_session (last_active_at)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS puma_session_archived_at_idx
  ON puma_session (archived_at)
  WHERE archived_at IS NOT NULL;

-- Append-only ADK event log. seq is a monotonically increasing counter per
-- session assigned by the application (NOT a serial — we control ordering).
-- The event JSONB is the full ADK Event object as-is.
CREATE TABLE IF NOT EXISTS puma_session_event (
  id          BIGSERIAL   PRIMARY KEY,
  session_id  TEXT        NOT NULL REFERENCES puma_session(id) ON DELETE CASCADE,
  seq         INTEGER     NOT NULL,
  event       JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS puma_session_event_session_seq_idx
  ON puma_session_event (session_id, seq);
