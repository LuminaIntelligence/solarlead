-- SolarLead AI - Database Schema
-- PostgreSQL / Supabase

-- ============================================================
-- Custom types
-- ============================================================

CREATE TYPE lead_status AS ENUM ('new', 'reviewed', 'contacted', 'qualified', 'rejected');
CREATE TYPE lead_source AS ENUM ('google_places', 'csv_import', 'manual');
CREATE TYPE provider_mode AS ENUM ('mock', 'live');

-- ============================================================
-- Tables
-- ============================================================

-- Solar Lead Mass -------------------------------------------------

CREATE TABLE solar_lead_mass (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  company_name  text NOT NULL,
  category      text NOT NULL,
  website       text,
  phone         text,
  email         text,
  address       text NOT NULL,
  city          text NOT NULL,
  postal_code   text,
  country       text NOT NULL DEFAULT 'DE',
  latitude      double precision,
  longitude     double precision,
  place_id      text,

  source        lead_source NOT NULL DEFAULT 'manual',

  business_score    real NOT NULL DEFAULT 0,
  electricity_score real NOT NULL DEFAULT 0,
  outreach_score    real NOT NULL DEFAULT 0,
  solar_score       real NOT NULL DEFAULT 0,
  total_score       real NOT NULL DEFAULT 0,

  status        lead_status NOT NULL DEFAULT 'new',
  notes         text,
  linkedin_url  text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Solar Assessments -----------------------------------------------

CREATE TABLE solar_assessments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                 uuid NOT NULL REFERENCES solar_lead_mass(id) ON DELETE CASCADE,
  provider                text NOT NULL,
  latitude                double precision NOT NULL,
  longitude               double precision NOT NULL,
  solar_quality           text,
  max_array_panels_count  integer,
  max_array_area_m2       real,
  annual_energy_kwh       real,
  sunshine_hours          real,
  carbon_offset           real,
  segment_count           integer,
  panel_capacity_watts    integer,
  raw_response_json       jsonb,

  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Lead Enrichment -------------------------------------------------

CREATE TABLE lead_enrichment (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL REFERENCES solar_lead_mass(id) ON DELETE CASCADE,
  website_title     text,
  meta_description  text,
  detected_keywords text[] NOT NULL DEFAULT '{}',
  enrichment_score  real NOT NULL DEFAULT 0,

  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Search Runs -----------------------------------------------------

CREATE TABLE search_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  query           text NOT NULL,
  filters         jsonb NOT NULL DEFAULT '{}',
  results_count   integer NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- User Settings ---------------------------------------------------

CREATE TABLE user_settings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL UNIQUE,
  google_places_api_key   text,
  google_solar_api_key    text,
  provider_mode           provider_mode NOT NULL DEFAULT 'mock',
  scoring_weights         jsonb NOT NULL DEFAULT '{"business": 0.25, "electricity": 0.25, "solar": 0.25, "outreach": 0.25}',

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_solar_lead_mass_user_id      ON solar_lead_mass(user_id);
CREATE INDEX idx_solar_lead_mass_status       ON solar_lead_mass(status);
CREATE INDEX idx_solar_lead_mass_total_score  ON solar_lead_mass(total_score DESC);
CREATE INDEX idx_solar_lead_mass_city         ON solar_lead_mass(city);
CREATE INDEX idx_solar_lead_mass_category     ON solar_lead_mass(category);
CREATE INDEX idx_solar_lead_mass_place_id     ON solar_lead_mass(place_id);

CREATE INDEX idx_solar_assessments_lead_id ON solar_assessments(lead_id);
CREATE INDEX idx_lead_enrichment_lead_id   ON lead_enrichment(lead_id);
CREATE INDEX idx_search_runs_user_id       ON search_runs(user_id);

-- ============================================================
-- Trigger: auto-update updated_at on solar_lead_mass
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_solar_lead_mass_updated_at
  BEFORE UPDATE ON solar_lead_mass
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE solar_lead_mass    ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar_assessments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_enrichment    ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings      ENABLE ROW LEVEL SECURITY;

-- Solar Lead Mass policies
CREATE POLICY solar_lead_mass_select ON solar_lead_mass
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY solar_lead_mass_insert ON solar_lead_mass
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY solar_lead_mass_update ON solar_lead_mass
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY solar_lead_mass_delete ON solar_lead_mass
  FOR DELETE USING (auth.uid() = user_id);

-- Solar assessments policies (via lead ownership)
CREATE POLICY solar_assessments_select ON solar_assessments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM solar_lead_mass WHERE solar_lead_mass.id = solar_assessments.lead_id AND solar_lead_mass.user_id = auth.uid())
  );

CREATE POLICY solar_assessments_insert ON solar_assessments
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM solar_lead_mass WHERE solar_lead_mass.id = solar_assessments.lead_id AND solar_lead_mass.user_id = auth.uid())
  );

CREATE POLICY solar_assessments_delete ON solar_assessments
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM solar_lead_mass WHERE solar_lead_mass.id = solar_assessments.lead_id AND solar_lead_mass.user_id = auth.uid())
  );

-- Lead enrichment policies (via lead ownership)
CREATE POLICY lead_enrichment_select ON lead_enrichment
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM solar_lead_mass WHERE solar_lead_mass.id = lead_enrichment.lead_id AND solar_lead_mass.user_id = auth.uid())
  );

CREATE POLICY lead_enrichment_insert ON lead_enrichment
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM solar_lead_mass WHERE solar_lead_mass.id = lead_enrichment.lead_id AND solar_lead_mass.user_id = auth.uid())
  );

CREATE POLICY lead_enrichment_delete ON lead_enrichment
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM solar_lead_mass WHERE solar_lead_mass.id = lead_enrichment.lead_id AND solar_lead_mass.user_id = auth.uid())
  );

-- Search runs policies
CREATE POLICY search_runs_select ON search_runs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY search_runs_insert ON search_runs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- User settings policies
CREATE POLICY user_settings_select ON user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY user_settings_insert ON user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_settings_update ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);
