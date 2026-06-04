-- Tracking-Spalten für existing_solar-Markierungen
-- Damit die Admin-Übersicht weiß WANN ein Lead Solar-markiert wurde
-- und durch welchen Mechanismus (OSM-Cron, MaStR-Backfill, manuell, etc.)

ALTER TABLE solar_lead_mass
  ADD COLUMN IF NOT EXISTS existing_solar_at timestamptz,
  ADD COLUMN IF NOT EXISTS existing_solar_source text;

-- Best-Effort Backfill: bestehende existing_solar-Leads bekommen updated_at
-- als Detection-Zeitpunkt und 'legacy' als Quelle (= vor Einführung des Trackings)
UPDATE solar_lead_mass
SET existing_solar_at = COALESCE(existing_solar_at, updated_at),
    existing_solar_source = COALESCE(existing_solar_source, 'legacy')
WHERE status = 'existing_solar'
  AND existing_solar_at IS NULL;

-- Index für die Admin-Übersicht
CREATE INDEX IF NOT EXISTS idx_solar_lead_mass_existing_solar
  ON solar_lead_mass(status, existing_solar_at DESC)
  WHERE status = 'existing_solar';
