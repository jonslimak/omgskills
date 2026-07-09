ALTER TABLE synced_skills
  ADD COLUMN IF NOT EXISTS skill_md_sha text,
  ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'localOnly';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'synced_skills_identity_status_check'
  ) THEN
    ALTER TABLE synced_skills
      ADD CONSTRAINT synced_skills_identity_status_check
      CHECK (identity_status IN ('resolved', 'ambiguous', 'localOnly'));
  END IF;
END $$;
