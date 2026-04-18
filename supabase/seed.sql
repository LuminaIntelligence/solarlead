-- SolarLead AI - Seed Data
-- NUR FÜR LOKALE ENTWICKLUNG / STAGING — NIEMALS AUF PRODUKTION AUSFÜHREN
-- ============================================================
-- SAFETY GUARD: Abbruch wenn Produktion erkannt wird
DO $$
BEGIN
  IF current_database() NOT IN ('postgres') OR
     EXISTS (SELECT 1 FROM auth.users WHERE email = 'consulting@lumina-intelligence.ai') THEN
    RAISE EXCEPTION 'SEED-SCHUTZ: Diese Datei darf nicht auf der Produktionsdatenbank ausgeführt werden!';
  END IF;
END;
$$;

DO $$
DECLARE
  uid uuid := '00000000-0000-0000-0000-000000000001';

  -- Lead IDs (fixed for FK references)
  l01 uuid := 'a0000000-0000-0000-0000-000000000001';
  l02 uuid := 'a0000000-0000-0000-0000-000000000002';
  l03 uuid := 'a0000000-0000-0000-0000-000000000003';
  l04 uuid := 'a0000000-0000-0000-0000-000000000004';
  l05 uuid := 'a0000000-0000-0000-0000-000000000005';
  l06 uuid := 'a0000000-0000-0000-0000-000000000006';
  l07 uuid := 'a0000000-0000-0000-0000-000000000007';
  l08 uuid := 'a0000000-0000-0000-0000-000000000008';
  l09 uuid := 'a0000000-0000-0000-0000-000000000009';
  l10 uuid := 'a0000000-0000-0000-0000-000000000010';
  l11 uuid := 'a0000000-0000-0000-0000-000000000011';
  l12 uuid := 'a0000000-0000-0000-0000-000000000012';
  l13 uuid := 'a0000000-0000-0000-0000-000000000013';
  l14 uuid := 'a0000000-0000-0000-0000-000000000014';
  l15 uuid := 'a0000000-0000-0000-0000-000000000015';

BEGIN

-- ============================================================
-- User settings
-- ============================================================

INSERT INTO user_settings (user_id, provider_mode, scoring_weights)
VALUES (uid, 'mock', '{"business": 0.25, "electricity": 0.25, "solar": 0.25, "outreach": 0.25}');

-- ============================================================
-- Leads
-- ============================================================

INSERT INTO solar_lead_mass (id, user_id, company_name, category, website, phone, email, address, city, postal_code, country, latitude, longitude, place_id, source, business_score, electricity_score, outreach_score, solar_score, total_score, status, notes, linkedin_url) VALUES

-- Munich
(l01, uid, 'Bayerische Spedition GmbH', 'logistics',
 'https://www.bay-spedition.de', '+49 89 1234567', 'info@bay-spedition.de',
 'Industriestr. 42', 'Munich', '80939', 'DE',
 48.1851, 11.5820, 'ChIJ_xyz_munich_01', 'google_places',
 82, 75, 60, 70, 71.75, 'new', NULL, NULL),

(l02, uid, 'Frischlogistik Meier KG', 'cold_storage',
 'https://www.frischlogistik-meier.de', '+49 89 9876543', 'kontakt@frischlogistik-meier.de',
 'Kuehlhausweg 7', 'Munich', '80807', 'DE',
 48.1920, 11.5680, 'ChIJ_xyz_munich_02', 'google_places',
 90, 95, 55, 80, 80.0, 'reviewed', 'Very high electricity consumption due to cooling', NULL),

(l03, uid, 'REWE Center Pasing', 'supermarket',
 'https://www.rewe.de', '+49 89 5551234', NULL,
 'Landsberger Str. 510', 'Munich', '81241', 'DE',
 48.1412, 11.4538, 'ChIJ_xyz_munich_03', 'google_places',
 65, 70, 40, 55, 57.5, 'new', NULL, NULL),

-- Hamburg
(l04, uid, 'Norddeutsche Metallwerke AG', 'manufacturing',
 'https://www.nd-metallwerke.de', '+49 40 3334455', 'vertrieb@nd-metallwerke.de',
 'Hafenweg 15', 'Hamburg', '20457', 'DE',
 53.5438, 9.9697, 'ChIJ_xyz_hamburg_01', 'google_places',
 88, 92, 70, 65, 78.75, 'contacted', 'Decision maker is Thomas Berger, COO', 'https://linkedin.com/in/thomas-berger-ndm'),

(l05, uid, 'Elbe Warehousing GmbH', 'warehouse',
 'https://www.elbe-warehousing.de', '+49 40 7788990', NULL,
 'Logistikpark 3', 'Hamburg', '21129', 'DE',
 53.5150, 9.8800, 'ChIJ_xyz_hamburg_02', 'google_places',
 72, 60, 50, 78, 65.0, 'new', NULL, NULL),

(l06, uid, 'Hotel Alster Panorama', 'hotel',
 'https://www.alster-panorama.de', '+49 40 1112233', 'reservierung@alster-panorama.de',
 'An der Alster 72', 'Hamburg', '20099', 'DE',
 53.5590, 10.0070, 'ChIJ_xyz_hamburg_03', 'google_places',
 60, 68, 75, 45, 62.0, 'new', NULL, NULL),

-- Berlin
(l07, uid, 'BerlinParts Autoteile GmbH', 'car_dealership',
 'https://www.berlinparts-auto.de', '+49 30 4445566', 'info@berlinparts-auto.de',
 'Berliner Str. 200', 'Berlin', '10715', 'DE',
 52.4870, 13.3370, 'ChIJ_xyz_berlin_01', 'google_places',
 55, 50, 65, 40, 52.5, 'new', NULL, NULL),

(l08, uid, 'Spree Kuehlhaus GmbH & Co. KG', 'cold_storage',
 'https://www.spree-kuehlhaus.de', '+49 30 9998877', 'anfrage@spree-kuehlhaus.de',
 'Industriegebiet Ost 18', 'Berlin', '12681', 'DE',
 52.5310, 13.5260, 'ChIJ_xyz_berlin_02', 'google_places',
 85, 90, 45, 72, 73.0, 'qualified', 'Contract discussion scheduled for next week', NULL),

(l09, uid, 'Baumarkt Tegel GmbH', 'hardware_store',
 'https://www.baumarkt-tegel.de', '+49 30 6665544', NULL,
 'Tegeler Weg 55', 'Berlin', '13507', 'DE',
 52.5920, 13.2870, 'ChIJ_xyz_berlin_03', 'google_places',
 58, 55, 48, 62, 55.75, 'new', NULL, NULL),

-- Frankfurt
(l10, uid, 'Rhein-Main Logistik AG', 'logistics',
 'https://www.rm-logistik.de', '+49 69 2223344', 'info@rm-logistik.de',
 'Am Flughafen 120', 'Frankfurt', '60549', 'DE',
 50.0379, 8.5622, 'ChIJ_xyz_frankfurt_01', 'google_places',
 92, 85, 80, 75, 83.0, 'contacted', 'Large rooftop area, very promising', 'https://linkedin.com/company/rm-logistik'),

(l11, uid, 'EDEKA Center Sachsenhausen', 'supermarket',
 NULL, '+49 69 8887766', NULL,
 'Schweizer Str. 88', 'Frankfurt', '60594', 'DE',
 50.1010, 8.6830, 'ChIJ_xyz_frankfurt_02', 'google_places',
 62, 68, 35, 50, 53.75, 'rejected', 'Building is rented, landlord not interested', NULL),

(l12, uid, 'Maintor Hotel & Kongresszentrum', 'hotel',
 'https://www.maintor-hotel.de', '+49 69 3332211', 'events@maintor-hotel.de',
 'Mainlust 5', 'Frankfurt', '60329', 'DE',
 50.1050, 8.6600, 'ChIJ_xyz_frankfurt_03', 'csv_import',
 70, 72, 68, 58, 67.0, 'reviewed', NULL, NULL),

-- Stuttgart
(l13, uid, 'Schwaben Autohaus Koenig', 'car_dealership',
 'https://www.autohaus-koenig-stuttgart.de', '+49 711 5554433', 'verkauf@autohaus-koenig.de',
 'Heilbronner Str. 300', 'Stuttgart', '70469', 'DE',
 48.8120, 9.1850, 'ChIJ_xyz_stuttgart_01', 'google_places',
 75, 62, 72, 68, 69.25, 'new', NULL, 'https://linkedin.com/company/autohaus-koenig'),

(l14, uid, 'Neckar Fertigungstechnik GmbH', 'manufacturing',
 'https://www.neckar-fertigung.de', '+49 711 1119988', 'technik@neckar-fertigung.de',
 'Gewerbepark Vaihingen 22', 'Stuttgart', '70565', 'DE',
 48.7270, 9.1060, 'ChIJ_xyz_stuttgart_02', 'manual',
 80, 88, 60, 74, 75.5, 'reviewed', 'CNC manufacturing, very high base load', NULL),

(l15, uid, 'Lager & mehr Stuttgart GmbH', 'warehouse',
 'https://www.lager-mehr-stgt.de', '+49 711 7776655', NULL,
 'Pragstr. 140', 'Stuttgart', '70376', 'DE',
 48.8050, 9.1930, 'ChIJ_xyz_stuttgart_03', 'google_places',
 68, 58, 42, 70, 59.5, 'new', NULL, NULL);

-- ============================================================
-- Solar Assessments
-- ============================================================

INSERT INTO solar_assessments (lead_id, provider, latitude, longitude, solar_quality, max_array_panels_count, max_array_area_m2, annual_energy_kwh, sunshine_hours, carbon_offset, segment_count, raw_response_json) VALUES

(l01, 'google_solar', 48.1851, 11.5820, 'HIGH',
 320, 540.0, 185000, 1680, 78.5, 4,
 '{"imageryDate": "2024-06-15", "imageryProcessedDate": "2024-07-01"}'),

(l02, 'google_solar', 48.1920, 11.5680, 'HIGH',
 480, 810.0, 278000, 1680, 117.8, 6,
 '{"imageryDate": "2024-06-15", "imageryProcessedDate": "2024-07-01"}'),

(l04, 'google_solar', 53.5438, 9.9697, 'MEDIUM',
 250, 420.0, 132000, 1520, 55.9, 3,
 '{"imageryDate": "2024-05-20", "imageryProcessedDate": "2024-06-05"}'),

(l08, 'google_solar', 52.5310, 13.5260, 'HIGH',
 400, 675.0, 220000, 1600, 93.2, 5,
 '{"imageryDate": "2024-07-10", "imageryProcessedDate": "2024-07-25"}'),

(l10, 'google_solar', 50.0379, 8.5622, 'HIGH',
 600, 1010.0, 345000, 1640, 146.1, 8,
 '{"imageryDate": "2024-04-18", "imageryProcessedDate": "2024-05-02"}'),

(l14, 'google_solar', 48.7270, 9.1060, 'MEDIUM',
 200, 338.0, 118000, 1660, 50.0, 3,
 '{"imageryDate": "2024-08-01", "imageryProcessedDate": "2024-08-15"}');

-- ============================================================
-- Lead Enrichment
-- ============================================================

INSERT INTO lead_enrichment (lead_id, website_title, meta_description, detected_keywords, enrichment_score) VALUES

(l01, 'Bayerische Spedition - Ihr Logistikpartner in Bayern',
 'Seit 1985 Ihr zuverlaessiger Partner fuer nationale und internationale Speditionsleistungen.',
 ARRAY['logistik', 'spedition', 'transport', 'lagerung', 'bayern'],
 72),

(l02, 'Frischlogistik Meier - Kuehllogistik und Tiefkuehllagerung',
 'Spezialist fuer temperaturempfindliche Waren. Kuehlkette von -25C bis +8C.',
 ARRAY['kuehllogistik', 'tiefkuehlung', 'kuehlkette', 'frischware', 'lebensmittel'],
 88),

(l04, 'Norddeutsche Metallwerke - Praezision aus Hamburg',
 'Hersteller hochwertiger Metallkomponenten fuer die Automobil- und Luftfahrtindustrie.',
 ARRAY['metallverarbeitung', 'cnc', 'automobil', 'luftfahrt', 'praezisionsteile'],
 80),

(l10, 'Rhein-Main Logistik - Ihr Hub im Herzen Europas',
 'Multimodale Logistikloesungen am Standort Frankfurt. Lager, Umschlag, Distribution.',
 ARRAY['logistik', 'distribution', 'umschlag', 'lager', 'frankfurt', 'flughafen'],
 85),

(l13, 'Autohaus Koenig Stuttgart - Neuwagen und Gebrauchtwagen',
 'Ihr Autohaus in Stuttgart fuer alle Marken. Verkauf, Service und Finanzierung.',
 ARRAY['autohaus', 'neuwagen', 'gebrauchtwagen', 'werkstatt', 'finanzierung'],
 55);

-- ============================================================
-- Search Runs
-- ============================================================

INSERT INTO search_runs (user_id, query, filters, results_count) VALUES

(uid, 'Logistik Muenchen', '{"category": "logistics", "city": "Munich", "radius_km": 25}', 8),
(uid, 'Kuehlhaus Berlin', '{"category": "cold_storage", "city": "Berlin", "radius_km": 30}', 5),
(uid, 'Supermarkt Frankfurt', '{"category": "supermarket", "city": "Frankfurt", "radius_km": 15}', 12);

END;
$$;
