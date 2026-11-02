-- One row per promo or offer code. platform: 'ios' (App Store offer code) or 'android' (Google Play promo code).
CREATE TABLE IF NOT EXISTS codes (
  code       TEXT PRIMARY KEY,
  url        TEXT NOT NULL DEFAULT '',
  added_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  claimed_at TEXT,
  client     TEXT,           -- hashed IP address of the claimer, for the daily limit
  platform   TEXT NOT NULL DEFAULT 'ios'
);
CREATE INDEX IF NOT EXISTS codes_unclaimed ON codes(claimed_at);
CREATE INDEX IF NOT EXISTS codes_client ON codes(client, claimed_at);
