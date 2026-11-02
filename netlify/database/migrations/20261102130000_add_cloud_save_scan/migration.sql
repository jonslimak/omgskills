-- Cloud save safety scan. Files that look like they contain a key or password
-- are held back until the user confirms them; other findings only label a version.
-- Findings record the rule and line, never the matched text.

ALTER TABLE cloud_blobs
  ADD COLUMN labels text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD CONSTRAINT cloud_blobs_labels_check
    CHECK (labels <@ ARRAY['download_and_run', 'invisible_characters', 'hidden_instructions', 'confirmed_secret']::text[]);

ALTER TABLE cloud_releases
  ADD COLUMN labels text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD CONSTRAINT cloud_releases_labels_check
    CHECK (labels <@ ARRAY['scripts', 'download_and_run', 'invisible_characters', 'hidden_instructions', 'confirmed_secret']::text[]);

CREATE TABLE cloud_secret_holds (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blob_sha text NOT NULL,
  findings jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  confirmed_by_device_id uuid REFERENCES device_tokens(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, blob_sha),
  CONSTRAINT cloud_secret_holds_sha_check CHECK (blob_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT cloud_secret_holds_findings_check CHECK (jsonb_typeof(findings) = 'array')
);

CREATE TABLE cloud_skill_reviews (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_key text NOT NULL,
  -- The Mac whose copy is waiting; another Mac's save of other content doesn't clear it.
  device_id uuid,
  files jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, skill_key),
  CONSTRAINT cloud_skill_reviews_files_check CHECK (jsonb_typeof(files) = 'array')
);
