-- LinkedIn-Outreach-Pipeline
--
-- Erlaubt parallel zur E-Mail-Pipeline persönliche InMail-Outreach via
-- LinkedIn. Channel-Routing entscheidet pro Lead: LinkedIn wenn URL
-- vorhanden, sonst Email. Garantiert: pro Lead nur ein Channel im Batch.
--
-- Send-Workflow ist manuell-assistiert: System zeigt Lead + Template +
-- "Auf LinkedIn öffnen"-Button. User schickt InMail über LinkedIn, kommt
-- zurück und markiert "Gesendet" — kein Browser-Automation, kein API-Risiko.

-- ── outreach_jobs: Channel-Routing ────────────────────────────────────
ALTER TABLE outreach_jobs
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'linkedin'));

-- LinkedIn-URL denormalisiert auf Job (für Anzeige im Dashboard)
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS linkedin_url text;

-- Zeitstempel + InMail-Counter (Sales Navigator hat Kontingent)
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS linkedin_sent_at timestamptz;
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS linkedin_message text;
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS linkedin_template_id uuid;
ALTER TABLE outreach_jobs ADD COLUMN IF NOT EXISTS linkedin_inmail_credits int NOT NULL DEFAULT 1;

-- Index für schnelles Filtern auf der LinkedIn-Dashboard-Seite
CREATE INDEX IF NOT EXISTS idx_outreach_jobs_channel ON outreach_jobs(channel);
CREATE INDEX IF NOT EXISTS idx_outreach_jobs_channel_status
  ON outreach_jobs(channel, status);

-- ── LinkedIn-Templates ────────────────────────────────────────────────
-- Personalisierungs-Tokens werden beim Anzeigen ersetzt:
--   {firstname}, {lastname}, {company}, {city}, {title}, {roof_m2}
CREATE TABLE IF NOT EXISTS linkedin_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  subject     text,           -- InMail-Subject (max 200 Zeichen LinkedIn-Limit)
  body        text NOT NULL,  -- InMail-Body (max 2000 Zeichen LinkedIn-Limit)
  is_active   boolean NOT NULL DEFAULT true,
  is_default  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE linkedin_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all_access" ON linkedin_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Default-Template seeden (nur ein Beispiel — Admin kann anpassen)
INSERT INTO linkedin_templates (name, subject, body, is_default)
VALUES (
  'Solar-Pacht-Standard',
  'Dachflächen-Pacht — Ihre Anlage produziert Strom, Sie verdienen mit',
  E'Guten Tag {firstname},\n\nich habe gesehen, dass {company} in {city} eine größere Gewerbefläche betreibt. Eine Frage: Hätten Sie Interesse, Ihre Dachfläche zu verpachten?\n\nGreenScout e.V. installiert die Solaranlage auf eigene Kosten, Sie kassieren jährlich eine feste Pacht — ohne Investition, ohne Risiko.\n\nLässt sich das in 15 Minuten am Telefon klären?\n\nViele Grüße\nSebastian Trautschold\nGreenScout e.V.',
  true
)
ON CONFLICT DO NOTHING;
