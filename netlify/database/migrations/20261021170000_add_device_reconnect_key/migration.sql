ALTER TABLE device_tokens
  ADD COLUMN reconnect_key_hash text,
  ADD CONSTRAINT device_tokens_reconnect_key_hash_format
    CHECK (reconnect_key_hash IS NULL OR
      (length(reconnect_key_hash) = 64 AND reconnect_key_hash ~ '^[0-9a-f]{64}$'));

CREATE UNIQUE INDEX device_tokens_user_reconnect_key_hash_idx
  ON device_tokens (user_id, reconnect_key_hash)
  WHERE reconnect_key_hash IS NOT NULL;
