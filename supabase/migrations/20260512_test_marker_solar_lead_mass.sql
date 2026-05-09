-- Nachgezogen: solar_lead_mass hat kein is_test_data-Spalte.
-- outreach_jobs.lead_id → FK auf solar_lead_mass(id), NICHT auf leads.
-- Heißt: für den Test-Seed muss ich Records in solar_lead_mass erstellen,
-- nicht in leads. solar_lead_mass braucht das Test-Marker-Feld auch.

ALTER TABLE solar_lead_mass ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_solar_lead_mass_test ON solar_lead_mass(is_test_data) WHERE is_test_data = true;
