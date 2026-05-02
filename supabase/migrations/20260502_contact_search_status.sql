-- Adds a persistent status field for contact-search backfill.
-- This makes the backfill resumable, idempotent, and atomic per lead.
--
-- Status values:
--   pending     – never tried (default for all existing/new leads)
--   searching   – currently being processed (acts as a lock)
--   found       – contact pipeline succeeded, contacts saved
--   not_found   – all 4 stages ran, no contacts found (won't retry)
--   error       – pipeline crashed (can be retried by resetting to pending)

ALTER TABLE solar_lead_mass
  ADD COLUMN IF NOT EXISTS contact_search_status text DEFAULT 'pending';

ALTER TABLE solar_lead_mass
  ADD COLUMN IF NOT EXISTS contact_search_at timestamptz;

-- Index for fast "next pending lead" queries
CREATE INDEX IF NOT EXISTS idx_lead_contact_search_status
  ON solar_lead_mass (contact_search_status)
  WHERE contact_search_status IN ('pending', 'searching', 'error');

-- Backfill existing data: any lead that already has contacts → 'found'
-- Everything else stays 'pending' (will be processed by the tool)
UPDATE solar_lead_mass
SET contact_search_status = 'found'
WHERE id IN (SELECT DISTINCT lead_id FROM lead_contacts)
  AND contact_search_status = 'pending';

-- Stuck "searching" rows should be reset on next run.
-- This UPDATE is safe because no job runs during migration.
UPDATE solar_lead_mass
SET contact_search_status = 'pending'
WHERE contact_search_status = 'searching';
