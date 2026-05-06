-- Schließt das Supabase-Advisor-Issue „Table publicly accessible".
--
-- VOR dieser Migration: ALLE 18 Tabellen im public-Schema waren via
-- Anon-Key (NEXT_PUBLIC_SUPABASE_ANON_KEY) offen lesbar UND schreibbar.
-- Das heißt: jeder mit der Projekt-URL konnte Lead-Daten, Kontakt-
-- Namen, Reply-Inhalte, API-Usage etc. abgrasen — ein DSGVO-Disaster.
--
-- Strategie:
--   1. Interne Tabellen (Webhook/Cron-only) → RLS on, NO policies
--      (= service_role-only Zugriff). Anon und User kommen nicht ran.
--   2. App-Tabellen → RLS on, "authenticated all access" Policy.
--      Bewahrt aktuelles Verhalten (alle eingeloggten User dürfen wie
--      bisher), schließt aber den Anon-Bypass. Die App-Auth läuft
--      ohnehin über Server-Endpoints mit requireAdmin/requireAuth —
--      RLS ist hier Defense-in-Depth gegen den bösen Anon-Key.
--
-- Granulare Policies (User sieht nur eigene Leads etc.) sind ein
-- separater Refactor-Schritt, der jeden Endpoint anfassen würde.
-- Hier nur das CRITICAL-Issue gefixt.

-- ── 1) Service-Role-only (interne Logs/State) ─────────────────────────
ALTER TABLE mailgun_inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_sync_state ENABLE ROW LEVEL SECURITY;
-- KEINE policies — service_role bypasst RLS automatisch.

-- ── 2) App-Tabellen: authenticated full access ─────────────────────────
DO $$
DECLARE
  tbl text;
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
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    -- Policy nur erstellen wenn sie noch nicht existiert (idempotent)
    EXECUTE format(
      'DROP POLICY IF EXISTS "authenticated_all_access" ON public.%I',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "authenticated_all_access" ON public.%I '
      'FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      tbl
    );
  END LOOP;
END $$;

-- ── 3) Anon-Insert/Update/Delete explizit verbieten ───────────────────
-- (Default mit RLS=on und keiner Policy für anon ist eh „deny", aber
--  wir machen's explizit für Audit-Klarheit. Skip falls anon-Reads für
--  z.B. öffentliche Inhalte irgendwann gewollt sind — dann gezielte
--  Policy hinzufügen.)
-- Nichts zu tun: keine "anon"-Policy = anon kann nicht zugreifen.
