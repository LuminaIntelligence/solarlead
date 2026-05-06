-- Migration 20260509 hat RLS auf alle Tabellen aktiviert + eine
-- "authenticated_all_access" Policy gesetzt. Aber auf einigen Tabellen
-- (z.B. `leads`) existieren noch ALTE Policies aus früheren Migrations
-- oder dem Supabase-UI, die anon-Zugriff erlauben.
--
-- Konkret: anon konnte nach 20260509 immer noch `leads` auslesen.
-- Diese Migration droppt ALLE Policies auf den App-Tabellen und setzt
-- nur die eine "authenticated_all_access" Policy neu — saubere Tabula-
-- Rasa, kein Reststaub aus früheren Migrations.

DO $$
DECLARE
  tbl text;
  pol record;
  app_tables text[] := ARRAY[
    'user_settings',
    'search_cells',
    'lead_contacts',
    'leads',
    'outreach_activities',
    'outreach_batches',
    'discovery_leads',
    'lead_activities',
    'outreach_jobs',
    'search_runs',
    'daily_api_usage',
    'solar_lead_mass',
    'lead_enrichment',
    'solar_assessments',
    'system_health_events',
    'discovery_campaigns'
  ];
BEGIN
  FOREACH tbl IN ARRAY app_tables LOOP
    -- Alle existierenden Policies auf der Tabelle droppen
    FOR pol IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;

    -- Frische Policy: nur authenticated, voller Zugriff
    EXECUTE format(
      'CREATE POLICY "authenticated_all_access" ON public.%I '
      'FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      tbl
    );
  END LOOP;
END $$;

-- Service-Role-only Tabellen: alle Policies wegräumen falls eine
-- legacy-Policy existieren sollte. RLS bleibt an, no policies = nur
-- service_role kommt durch.
DO $$
DECLARE
  pol record;
  internal_tables text[] := ARRAY['mailgun_inbound_events', 'inbound_sync_state'];
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY internal_tables LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;
  END LOOP;
END $$;
