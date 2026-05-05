-- Mailgun Inbound Events Log
-- Records every call to /api/webhooks/mailgun-inbound for debugging.
-- The "Antworten"-Page reads the last ~20 entries to show admins what's
-- arriving (or not arriving) — answers the question "ist mein Setup richtig?"

CREATE TABLE IF NOT EXISTS mailgun_inbound_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at  timestamptz NOT NULL DEFAULT now(),
  from_email   text,
  recipient    text,
  subject      text,
  -- 'matched' = job found + updated, 'no_match' = no outreach_jobs hit,
  -- 'invalid_signature' = Mailgun signature rejected, 'error' = exception
  result       text NOT NULL,
  job_id       uuid REFERENCES outreach_jobs(id) ON DELETE SET NULL,
  assigned_to  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_opt_out   boolean NOT NULL DEFAULT false,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_mailgun_inbound_received_at
  ON mailgun_inbound_events(received_at DESC);

-- 30-day retention is plenty for debugging
COMMENT ON TABLE mailgun_inbound_events IS
  'Audit log of Mailgun inbound webhook calls. Used by /admin/outreach/replies to surface setup issues.';
