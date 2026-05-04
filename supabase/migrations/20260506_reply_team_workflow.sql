-- =====================================================================
-- Reply-Team Workflow — assignment, outcome tracking, activities, SLA.
-- =====================================================================
--
-- Three new roles: 'reply_specialist' (sees own + pool), 'team_lead' (sees
-- all replies), in addition to the existing 'admin' (sees everything) and
-- 'user' (regular CRM user).
--
-- New columns on outreach_jobs:
--   - next_action_at       : timestamptz, the reminder / Wiedervorlage time
--   - next_action_note     : text, what the specialist plans to do
--   - outcome              : structured classification (see CHECK below)
--   - outcome_at           : when outcome was last set
--   - closed_value_eur     : populated when outcome='closed_won'
--   - last_activity_at     : auto-updated by trigger; used for SLA tracking
--   - assigned_at          : when assigned_to was last set
--
-- New table outreach_activities — audit log of every interaction:
--   call_attempted | call_connected | email_sent | note | stage_changed |
--   outcome_changed | reminder_set | reassigned | claimed
--
-- Indexes optimized for the inbox query patterns (today/overdue/pool).

-- 1. Expand role enum on user_settings
ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_role_check;

ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_role_check
  CHECK (role IN ('user', 'reply_specialist', 'team_lead', 'admin'));

-- 2. New columns on outreach_jobs
ALTER TABLE outreach_jobs
  ADD COLUMN IF NOT EXISTS next_action_at      timestamptz,
  ADD COLUMN IF NOT EXISTS next_action_note    text,
  ADD COLUMN IF NOT EXISTS outcome             text DEFAULT 'new'
    CHECK (outcome IN ('new', 'in_progress', 'appointment_set',
                       'callback_requested', 'not_reached', 'not_interested',
                       'closed_won', 'closed_lost', 'on_hold')),
  ADD COLUMN IF NOT EXISTS outcome_at          timestamptz,
  ADD COLUMN IF NOT EXISTS closed_value_eur    numeric,
  ADD COLUMN IF NOT EXISTS last_activity_at    timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS assigned_at         timestamptz;

-- 3. outreach_activities — append-only audit log + notes + call logs
CREATE TABLE IF NOT EXISTS outreach_activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES outreach_jobs(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN (
    'call_attempted','call_connected','email_sent','note',
    'stage_changed','outcome_changed','reminder_set','reassigned','claimed'
  )),
  content       text,
  context       jsonb,            -- e.g. {"old": "in_progress", "new": "appointment_set"}
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_activities_job
  ON outreach_activities(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_activities_user
  ON outreach_activities(user_id, created_at DESC);

-- 4. Helpful indexes on outreach_jobs for the inbox queries
CREATE INDEX IF NOT EXISTS idx_outreach_jobs_assigned_active
  ON outreach_jobs(assigned_to, outcome)
  WHERE assigned_to IS NOT NULL
    AND outcome NOT IN ('closed_won', 'closed_lost', 'not_interested');

CREATE INDEX IF NOT EXISTS idx_outreach_jobs_pool
  ON outreach_jobs(replied_at)
  WHERE assigned_to IS NULL AND status = 'replied';

CREATE INDEX IF NOT EXISTS idx_outreach_jobs_next_action
  ON outreach_jobs(next_action_at)
  WHERE next_action_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outreach_jobs_replied_at
  ON outreach_jobs(replied_at DESC)
  WHERE status = 'replied';

-- 5. Trigger: auto-update last_activity_at on any outreach_activities insert
CREATE OR REPLACE FUNCTION bump_job_last_activity_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE outreach_jobs
    SET last_activity_at = NEW.created_at
    WHERE id = NEW.job_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_outreach_activities_bump ON outreach_activities;
CREATE TRIGGER trg_outreach_activities_bump
  AFTER INSERT ON outreach_activities
  FOR EACH ROW EXECUTE FUNCTION bump_job_last_activity_at();

-- 6. Backfill: any job with status='replied' but outcome IS NULL → 'new'
--    so existing replied jobs land properly in the team inbox.
UPDATE outreach_jobs
  SET outcome = 'new'
  WHERE status = 'replied' AND (outcome IS NULL OR outcome = '');

-- 7. Grants for PostgREST schema cache
GRANT ALL ON outreach_jobs, outreach_activities TO postgres, service_role, authenticated;

NOTIFY pgrst, 'reload schema';
