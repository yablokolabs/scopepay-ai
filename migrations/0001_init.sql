-- ScopePay durable state (Cloudflare D1 / SQLite dialect).
-- Money is stored as INTEGER cents. Timestamps are ISO-8601 TEXT.
-- Scope versions are insert-only; only their status lifecycle row is updated.

CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  submitted_by TEXT NOT NULL,
  canonical_text TEXT NOT NULL,
  text_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_briefs_text_hash ON briefs (text_hash);

CREATE TABLE IF NOT EXISTS scope_versions (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  brief_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  catalog_version TEXT NOT NULL,
  lines TEXT NOT NULL,
  exclusions TEXT NOT NULL,
  revision_limit INTEGER,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_action TEXT,
  review_note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scopes_brief_version ON scope_versions (brief_id, version);
CREATE INDEX IF NOT EXISTS idx_scopes_brief ON scope_versions (brief_id);
CREATE INDEX IF NOT EXISTS idx_scopes_status ON scope_versions (status);

CREATE TABLE IF NOT EXISTS acceptances (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL,
  actor TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  confirmed_amount_minor INTEGER NOT NULL,
  confirmed_currency TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  expected_amount_minor INTEGER NOT NULL,
  expected_currency TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  paypal_order_id TEXT,
  capture_id TEXT,
  provider_status TEXT,
  state TEXT NOT NULL,
  approval_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  provider_amount_minor INTEGER,
  provider_currency TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_scope ON payment_attempts (scope_id);
CREATE INDEX IF NOT EXISTS idx_attempts_order ON payment_attempts (paypal_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_capture ON payment_attempts (capture_id);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  verification_state TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_state TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_resource ON events (resource_id);
CREATE INDEX IF NOT EXISTS idx_events_received ON events (received_at);
