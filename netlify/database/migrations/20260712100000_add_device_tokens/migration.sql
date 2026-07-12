ALTER TABLE sync_tokens
  ADD COLUMN purpose text NOT NULL DEFAULT 'legacy_upload',
  ADD COLUMN code_challenge text,
  ADD COLUMN code_challenge_method text,
  ADD CONSTRAINT sync_tokens_purpose_check
    CHECK (purpose IN ('legacy_upload', 'device_exchange')),
  ADD CONSTRAINT sync_tokens_challenge_check
    CHECK (
      (code_challenge IS NULL AND code_challenge_method IS NULL)
      OR (
        purpose = 'device_exchange'
        AND code_challenge IS NOT NULL
        AND code_challenge_method = 'S256'
      )
    );

CREATE TABLE device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  device_name text NOT NULL,
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_tokens_name_check
    CHECK (
      char_length(device_name) BETWEEN 1 AND 100
      AND device_name = btrim(device_name)
    ),
  CONSTRAINT device_tokens_expiry_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX device_tokens_token_hash_unique ON device_tokens(token_hash);
CREATE INDEX device_tokens_user_idx ON device_tokens(user_id);
CREATE INDEX device_tokens_user_active_idx
  ON device_tokens(user_id, created_at)
  WHERE revoked_at IS NULL;
