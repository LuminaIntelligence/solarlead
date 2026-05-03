-- =====================================================================
-- Discovery Automation — schema for unattended, scheduled lead discovery
-- =====================================================================
--
-- This migration introduces:
--   1. discovery_campaigns + discovery_leads (the core tables — TS code
--      already references these, but they were never created in schema.sql)
--   2. search_cells — atomic search units (one geo-point × one category)
--   3. daily_api_usage — per-day per-provider call/cost tracking for budget cap
--   4. system_health_events — heartbeat/error log read by /admin/discovery/health
--   5. user_settings.places_daily_budget_eur + alert_email
--
-- All CREATE statements are IF NOT EXISTS so this is idempotent. Indexes
-- are partial where possible (only "live" rows are indexed).

-- ---------------------------------------------------------------
-- 1. discovery_campaigns
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS discovery_campaigns (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by               uuid NOT NULL,
  name                     text NOT NULL,
  description              text,
  status                   text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','running','completed','failed','paused')),
  areas                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  categories               text[] NOT NULL DEFAULT '{}',
  search_keyword           text,
  auto_approve_threshold   int NOT NULL DEFAULT 70,

  -- Counters (populated by runner)
  total_discovered         int NOT NULL DEFAULT 0,
  total_enriched           int NOT NULL DEFAULT 0,
  total_ready              int NOT NULL DEFAULT 0,
  total_approved           int NOT NULL DEFAULT 0,
  total_duplicates         int NOT NULL DEFAULT 0,

  started_at               timestamptz,
  completed_at             timestamptz,
  error_message            text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_campaigns_status
  ON discovery_campaigns(status, created_at DESC);

-- ---------------------------------------------------------------
-- 2. discovery_leads
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS discovery_leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL REFERENCES discovery_campaigns(id) ON DELETE CASCADE,
  lead_id             uuid REFERENCES solar_lead_mass(id) ON DELETE SET NULL,

  company_name        text NOT NULL,
  address             text,
  city                text,
  postal_code         text,
  country             text DEFAULT 'DE',
  category            text,
  website             text,
  phone               text,
  place_id            text,
  latitude            numeric,
  longitude           numeric,

  -- Enrichment results
  total_score         int,
  has_contacts        boolean DEFAULT false,
  has_solar_data      boolean DEFAULT false,
  contact_count       int DEFAULT 0,
  solar_quality       text,
  max_array_area_m2   numeric,

  status              text NOT NULL DEFAULT 'pending_enrichment'
                      CHECK (status IN ('pending_enrichment','enriching','ready','insufficient_data','approved','rejected')),
  rejection_reason    text,
  solar_error         text,
  approved_at         timestamptz,
  approved_by         uuid,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_leads_campaign  ON discovery_leads(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_discovery_leads_place_id  ON discovery_leads(place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_discovery_leads_lead_id   ON discovery_leads(lead_id) WHERE lead_id IS NOT NULL;

-- ---------------------------------------------------------------
-- 3. search_cells — atomic units of search work
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS search_cells (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL REFERENCES discovery_campaigns(id) ON DELETE CASCADE,

  -- Geographic + category dimension
  area_label          text NOT NULL,      -- "München (50km)"
  area_type           text NOT NULL CHECK (area_type IN ('city','radius')),
  area_city           text,               -- only for area_type='city'
  area_lat            numeric,            -- only for area_type='radius'
  area_lng            numeric,
  area_radius_km      numeric,
  category            text NOT NULL,
  search_keyword      text,

  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','searching','done','no_results','error','paused')),
  attempts            int NOT NULL DEFAULT 0,
  last_attempt_at     timestamptz,

  -- Results
  places_found        int DEFAULT 0,
  places_new          int DEFAULT 0,
  duration_ms         int,
  error_message       text,
  last_error_kind     text,               -- 'timeout'|'rate_limit'|'auth'|'network'|'other'

  -- Scheduling
  priority            int NOT NULL DEFAULT 0,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_cells_status_priority
  ON search_cells(status, priority DESC, created_at)
  WHERE status IN ('pending','error');

CREATE INDEX IF NOT EXISTS idx_search_cells_campaign
  ON search_cells(campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_search_cells_searching
  ON search_cells(last_attempt_at)
  WHERE status = 'searching';

-- ---------------------------------------------------------------
-- 4. daily_api_usage — provider cost & quota tracking
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_api_usage (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date NOT NULL,
  provider            text NOT NULL,                  -- 'google_places', 'apollo', etc.
  calls               int NOT NULL DEFAULT 0,
  estimated_cost_eur  numeric NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (date, provider)
);

CREATE INDEX IF NOT EXISTS idx_daily_api_usage_date ON daily_api_usage(date DESC);

-- ---------------------------------------------------------------
-- 5. system_health_events — heartbeat + alert log
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS system_health_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts          timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL,        -- 'discovery_tick' | 'cell_runner' | 'budget_check' | ...
  kind        text NOT NULL CHECK (kind IN ('heartbeat','info','warning','error','alert_sent')),
  message     text NOT NULL,
  context     jsonb,                -- { cell_id, campaign_id, error_kind, ... }

  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_health_events_ts ON system_health_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_system_health_events_kind ON system_health_events(kind, ts DESC)
  WHERE kind IN ('error','warning','alert_sent');

-- Auto-prune events older than 30 days (vacuum runs nightly)
-- (kept simple: a periodic delete via cron would be cleaner, but this is fine for start)

-- ---------------------------------------------------------------
-- 6. user_settings extensions
-- ---------------------------------------------------------------

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS places_daily_budget_eur numeric NOT NULL DEFAULT 10;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS alert_email text;

-- ---------------------------------------------------------------
-- 7. updated_at triggers (reuse the existing function)
-- ---------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_discovery_campaigns_updated_at ON discovery_campaigns;
CREATE TRIGGER trg_discovery_campaigns_updated_at
  BEFORE UPDATE ON discovery_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_discovery_leads_updated_at ON discovery_leads;
CREATE TRIGGER trg_discovery_leads_updated_at
  BEFORE UPDATE ON discovery_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_search_cells_updated_at ON search_cells;
CREATE TRIGGER trg_search_cells_updated_at
  BEFORE UPDATE ON search_cells
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_daily_api_usage_updated_at ON daily_api_usage;
CREATE TRIGGER trg_daily_api_usage_updated_at
  BEFORE UPDATE ON daily_api_usage
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
