ALTER TABLE cloud_blobs ADD COLUMN storage_key text;

CREATE TABLE cloud_storage_purge_queue (
  user_id uuid NOT NULL,
  storage_key text PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cloud_storage_purge_queue_user ON cloud_storage_purge_queue (user_id, queued_at);

CREATE TABLE cloud_storage_sweep_cursor (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  continuation_token text
);
