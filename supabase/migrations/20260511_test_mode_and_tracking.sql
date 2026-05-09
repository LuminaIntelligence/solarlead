-- Test-Modus + Mailgun-Event-Tracking
--
-- 1) is_test_data Marker auf allen Tabellen, die durch den Test-Seed
--    geschrieben werden. Reset löscht NUR Rows mit is_test_data=true —
--    das echte Geschäft bleibt unangetastet.
--
-- 2) Mailgun-Event-Tracking: zusätzliche Spalten auf outreach_jobs für
--    Delivered/Opened/Clicked/Bounced. Mailgun liefert die Events via
--    Webhook /api/webhooks/mailgun-events. Wir matchen über die
--    Custom-Variable v:job-id, die beim Versand gesetzt wird.

-- ── Test-Marker ───────────────────────────────────────────────────────
ALTER TABLE leads               ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE lead_contacts       ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE outreach_batches    ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE outreach_jobs       ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE solar_assessments   ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE outreach_activities ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_settings       ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_outreach_jobs_test     ON outreach_jobs(is_test_data) WHERE is_test_data = true;
CREATE INDEX IF NOT EXISTS idx_outreach_batches_test  ON outreach_batches(is_test_data) WHERE is_test_data = true;
CREATE INDEX IF NOT EXISTS idx_leads_test             ON leads(is_test_data) WHERE is_test_data = true;

-- ── Mailgun-Event-Tracking-Spalten ────────────────────────────────────
-- opened_at existiert bereits (Legacy) — wir nutzen das als "first opened".
-- Zusätzlich: Counts + Spezial-Timestamps für volle Pipeline-Analyse.
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS delivered_at      timestamptz;
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS clicked_at        timestamptz;
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS opens_count       integer NOT NULL DEFAULT 0;
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS clicks_count      integer NOT NULL DEFAULT 0;
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS bounced_at        timestamptz;
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS bounce_reason     text;
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS unsubscribed_at   timestamptz;
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS complained_at     timestamptz;

-- Mailgun-Event-Audit-Log: jeder eingehende Event landet hier.
-- Reine Append-Tabelle, hilft beim Debugging "warum ist meine Mail
-- nicht als opened markiert" und bei DSGVO-Audits ("wann wurde
-- aufgehört zu tracken").
CREATE TABLE IF NOT EXISTS mailgun_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),
  event         text NOT NULL,           -- 'delivered'|'opened'|'clicked'|'failed'|...
  job_id        uuid REFERENCES outreach_jobs(id) ON DELETE SET NULL,
  recipient     text,
  message_id    text,
  url           text,                    -- bei clicked: welche URL?
  reason        text,                    -- bei failed/permanent_failure
  raw_payload   jsonb
);

CREATE INDEX IF NOT EXISTS idx_mailgun_events_job   ON mailgun_events(job_id);
CREATE INDEX IF NOT EXISTS idx_mailgun_events_event ON mailgun_events(event);
CREATE INDEX IF NOT EXISTS idx_mailgun_events_recv  ON mailgun_events(received_at DESC);

-- RLS: nur service_role
ALTER TABLE mailgun_events ENABLE ROW LEVEL SECURITY;
