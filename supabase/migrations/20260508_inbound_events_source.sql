-- Add `source` column to mailgun_inbound_events so we can distinguish
-- Mailgun-Webhook events from IMAP-Pull events (Weg C in der Architektur).
-- Same table, same audit format, different ingestion path.
--
-- Existing rows are all from Mailgun → DEFAULT 'mailgun' is correct.

ALTER TABLE mailgun_inbound_events
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'mailgun';

-- Track when the last IMAP poll ran (for the diagnostic panel).
-- Singleton row keyed by 'imap'.
CREATE TABLE IF NOT EXISTS inbound_sync_state (
  channel       text PRIMARY KEY,
  last_run_at   timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_error    text,
  messages_checked int NOT NULL DEFAULT 0,
  replies_found int NOT NULL DEFAULT 0,
  opt_outs_found int NOT NULL DEFAULT 0
);
