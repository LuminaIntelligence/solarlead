-- LinkedIn-URL-Finder via Google Custom Search API
--
-- Tracking-Spalten auf lead_contacts: wann gesucht, wie zuversichtlich,
-- woher entdeckt (apollo / impressum / google_cse / manual).
-- linkedin_search_at auf solar_lead_mass verhindert dass derselbe Lead
-- mehrfach durchsucht wird wenn Modus B keinen Treffer fand.

ALTER TABLE lead_contacts ADD COLUMN IF NOT EXISTS linkedin_search_at timestamptz;
ALTER TABLE lead_contacts ADD COLUMN IF NOT EXISTS linkedin_search_confidence numeric;
ALTER TABLE lead_contacts ADD COLUMN IF NOT EXISTS linkedin_search_query text;
ALTER TABLE lead_contacts ADD COLUMN IF NOT EXISTS discovered_via text;

ALTER TABLE solar_lead_mass ADD COLUMN IF NOT EXISTS linkedin_search_at timestamptz;
ALTER TABLE solar_lead_mass ADD COLUMN IF NOT EXISTS linkedin_search_result text;
-- linkedin_search_result: 'matched' (Treffer übernommen), 'review' (manuell),
-- 'no_result' (Google fand nichts), 'low_confidence' (alle Treffer < threshold)

CREATE INDEX IF NOT EXISTS idx_solar_lead_mass_linkedin_search
  ON solar_lead_mass(linkedin_search_at) WHERE linkedin_search_at IS NULL;
