CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users whitelisted to access the tool
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL      PRIMARY KEY,
  email      TEXT        NOT NULL UNIQUE,
  name       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

-- express-session store (connect-pg-simple default schema)
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR     NOT NULL COLLATE "default",
  "sess"   JSON        NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON "session" ("expire");

CREATE TABLE IF NOT EXISTS scans (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  status       TEXT        NOT NULL DEFAULT 'queued',
  mode         TEXT        NOT NULL,
  input        JSONB       NOT NULL,
  pages_discovered INT     NOT NULL DEFAULT 0,
  pages_scanned    INT     NOT NULL DEFAULT 0,
  stop_requested   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS findings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id          UUID        NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  url              TEXT        NOT NULL,
  type             TEXT        NOT NULL DEFAULT 'accessibility',
  source_tool      TEXT        NOT NULL DEFAULT 'axe-core',
  rule_id          TEXT,
  wcag_tags        JSONB,
  impact           TEXT,
  description      TEXT,
  help             TEXT,
  help_url         TEXT,
  target_selector  TEXT,
  breadcrumb       JSONB,
  html_snippet     TEXT,
  failure_summary  TEXT,
  location         JSONB,
  screenshot_path  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_errors (
  id         SERIAL      PRIMARY KEY,
  scan_id    UUID        NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  url        TEXT,
  message    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS findings_scan_id_idx  ON findings(scan_id);
CREATE INDEX IF NOT EXISTS findings_impact_idx   ON findings(impact);
CREATE INDEX IF NOT EXISTS errors_scan_id_idx    ON scan_errors(scan_id);
CREATE INDEX IF NOT EXISTS scans_created_at_idx  ON scans(created_at DESC);

-- One row per page visited — stores pre-computed finding counts so the
-- pages list can be shown quickly without joining to the findings table.
CREATE TABLE IF NOT EXISTS pages (
  id             SERIAL      PRIMARY KEY,
  scan_id        UUID        NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  url            TEXT        NOT NULL,
  findings_count INT         NOT NULL DEFAULT 0,
  critical_count INT         NOT NULL DEFAULT 0,
  serious_count  INT         NOT NULL DEFAULT 0,
  moderate_count INT         NOT NULL DEFAULT 0,
  minor_count    INT         NOT NULL DEFAULT 0,
  scanned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pages_scan_id_idx ON pages(scan_id);

-- Add scan initiator email (safe to re-run on existing databases)
ALTER TABLE scans ADD COLUMN IF NOT EXISTS started_by_email TEXT;
