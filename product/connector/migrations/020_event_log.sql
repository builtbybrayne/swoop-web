-- 020_event_log.sql — F-c: durable collection sink for the chunk-F event stream.
--
-- Written by createPostgresEventSink (@swoop/connector) when EVENT_SINK=postgres.
-- Both the orchestrator and connector processes append here — single store per
-- C.18 (same Postgres instance as retrieval + sessions + handoff).
--
-- PII posture (unchanged from chunk F): events carry message lengths + sha256,
-- never content — so this table holds no visitor text. `event` is the full
-- validated Event; the hot-query columns are denormalised projections of it.
--
-- Retention: a DELETE-by-age sweep is a documented fast-follow (plan §4). The
-- table is PII-safe, so unbounded growth is an ops concern, not a compliance one.

CREATE TABLE IF NOT EXISTS event_log (
  id          BIGSERIAL   PRIMARY KEY,
  event_type  TEXT        NOT NULL,
  severity    TEXT        NOT NULL,
  session_id  TEXT        NOT NULL,
  turn_index  INTEGER     NULL,
  actor       TEXT        NOT NULL,
  event       JSONB       NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_log_type_idx     ON event_log (event_type);
CREATE INDEX IF NOT EXISTS event_log_session_idx  ON event_log (session_id);
CREATE INDEX IF NOT EXISTS event_log_ts_idx       ON event_log (ts);
-- Partial index keeps "show me recent problems" fast as INFO dominates volume.
CREATE INDEX IF NOT EXISTS event_log_severity_idx ON event_log (severity) WHERE severity <> 'INFO';
