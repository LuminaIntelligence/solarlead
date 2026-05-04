-- =====================================================================
-- User-Editing Capabilities — track WHO edited a lead/contact and WHEN,
-- and let users mark a primary contact per lead.
-- =====================================================================
--
-- Adds:
--   * solar_lead_mass.last_edited_by + last_edited_at
--   * lead_contacts.last_edited_by + last_edited_at + is_primary
--
-- Backend will populate last_edited_by / last_edited_at on each PATCH; the
-- UI can show "edited by X on Y" badges next to manually overridden fields.
--
-- is_primary marks the main contact for outreach. We don't enforce uniqueness
-- via a partial UNIQUE index (would block batch updates); instead the API
-- clears all other contacts' is_primary when one is promoted.

ALTER TABLE solar_lead_mass
  ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;

ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Helpful indexes for common access patterns
CREATE INDEX IF NOT EXISTS idx_lead_contacts_lead_primary
  ON lead_contacts (lead_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_solar_lead_mass_last_edited_at
  ON solar_lead_mass (last_edited_at DESC)
  WHERE last_edited_at IS NOT NULL;

-- Service-role grants so PostgREST schema cache discovers the new columns
-- and the API can read/write them without RLS friction.
GRANT ALL ON solar_lead_mass, lead_contacts
  TO postgres, service_role, authenticated;

NOTIFY pgrst, 'reload schema';
