-- Fügt den Wert 'follow_up' zum lead_status-Enum hinzu.
--
-- Das Enum lead_status (new, reviewed, contacted, qualified, rejected,
-- existing_solar) wurde initial strikter definiert als unsere TypeScript-
-- LeadStatus-Union. Für die neue Pipeline-Spalte "Wiedervorlage" brauchen
-- wir den Status 'follow_up' auch auf DB-Ebene.
--
-- WICHTIG: ALTER TYPE ... ADD VALUE kann in Postgres nicht innerhalb einer
-- Transaktion laufen. Dieses File muss direkt in der Supabase SQL Editor
-- oder per supabase CLI ausgeführt werden, NICHT via normalem Migration-
-- Runner der alles in BEGIN/COMMIT wrapped.

ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'follow_up' AFTER 'contacted';
