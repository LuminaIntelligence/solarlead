-- Lead-Bilder: Field-Members hängen Fotos an Leads (Dach, Gebäude, Visitenkarte, ...)
-- Bilder liegen in Supabase Storage Bucket 'lead-images', Metadaten in dieser Tabelle.

CREATE TABLE IF NOT EXISTS lead_images (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES solar_lead_mass(id) ON DELETE CASCADE,
  storage_path    text NOT NULL,                              -- z.B. "abc123/xyz789.jpg"
  file_name       text,                                        -- Original-Dateiname (für Download-Vorschlag)
  file_size_bytes integer,
  mime_type       text,
  width_px        integer,
  height_px       integer,
  caption         text,                                        -- optionaler User-Kommentar
  uploaded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_images_lead
  ON lead_images(lead_id, uploaded_at DESC);

-- RLS: konsistent mit dem Rest der App — Access-Control passiert im API-Layer
-- via hasLeadAccess(), nicht via Row-Level-Policies.
ALTER TABLE lead_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_access" ON lead_images;
CREATE POLICY "authenticated_all_access" ON lead_images
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
