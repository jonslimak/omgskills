-- Why each Mac didn't save a skill, reported after every pass so the web can say why.
-- One row per Mac, replaced by its next report. Skill keys and reasons only, never contents or paths.

CREATE TABLE cloud_skip_reports (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
  skipped jsonb NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id),
  CONSTRAINT cloud_skip_reports_skipped_check CHECK (jsonb_typeof(skipped) = 'object')
);
