-- DB-backed admin role for defense in depth.
--
-- Previously, admin gating relied on auth.users.raw_user_meta_data->>'role',
-- which is USER-WRITABLE via supabase.auth.updateUser({ data: { role: 'admin' } })
-- in some configurations. This migration introduces a server-controlled source
-- of truth in user_settings.role.
--
-- After this migration:
--   * Application code uses requireAdmin() which queries user_settings.role
--   * Only the service-role key can write to user_settings.role
--   * RLS prevents any client-side modification

-- 1. Add role column with safe default
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_role_check
  CHECK (role IN ('user', 'admin'));

CREATE INDEX IF NOT EXISTS idx_user_settings_role
  ON user_settings (role)
  WHERE role = 'admin';

-- 2. Seed admin role from existing user_metadata (one-time migration)
-- For users who don't yet have a user_settings row, create one with the admin role.
INSERT INTO user_settings (user_id, role)
SELECT
  u.id,
  'admin'
FROM auth.users u
WHERE u.raw_user_meta_data->>'role' = 'admin'
  AND NOT EXISTS (SELECT 1 FROM user_settings s WHERE s.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

UPDATE user_settings s
SET role = 'admin'
FROM auth.users u
WHERE s.user_id = u.id
  AND u.raw_user_meta_data->>'role' = 'admin'
  AND s.role <> 'admin';

-- 3. Tighten RLS so users CAN read their own role but CANNOT write it.
-- (The existing user_settings_update policy is rewritten to exclude role.)
DROP POLICY IF EXISTS user_settings_update ON user_settings;

-- Users can update their own settings, but the role column stays unchanged.
-- We enforce this via a trigger that prevents non-service-role updates to `role`.
CREATE OR REPLACE FUNCTION enforce_role_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- The service role bypasses RLS entirely. Regular authenticated users hitting
  -- this trigger must not change `role`.
  IF current_setting('role') <> 'service_role'
     AND OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'role column is read-only for non-service-role updates';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_settings_role_immutable ON user_settings;
CREATE TRIGGER trg_user_settings_role_immutable
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION enforce_role_immutability();

CREATE POLICY user_settings_update ON user_settings
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
