-- Deploy only with the scoped writers: old servers require the replaced constraint.
ALTER TABLE sync_runs ADD COLUMN device_id uuid REFERENCES device_tokens(id) ON DELETE NO ACTION;
ALTER TABLE synced_skills
  ADD COLUMN device_id uuid REFERENCES device_tokens(id) ON DELETE NO ACTION,
  ADD COLUMN git_relative_path text,
  ADD COLUMN catalog_skill_id_hint text;

ALTER TABLE synced_skills DROP CONSTRAINT synced_skills_user_stable_key_unique;
CREATE UNIQUE INDEX synced_skills_legacy_location_unique
  ON synced_skills(user_id, stable_key) WHERE device_id IS NULL;
CREATE UNIQUE INDEX synced_skills_device_location_unique
  ON synced_skills(user_id, device_id, stable_key) WHERE device_id IS NOT NULL;
CREATE INDEX sync_runs_user_device_completed_idx ON sync_runs(user_id, device_id, completed_at);
