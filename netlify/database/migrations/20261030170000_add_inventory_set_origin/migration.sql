ALTER TABLE synced_skills
  ADD COLUMN IF NOT EXISTS installed_from_set text;
