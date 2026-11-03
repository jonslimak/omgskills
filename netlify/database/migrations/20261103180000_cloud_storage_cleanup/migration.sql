-- One queue of stored files to remove (see netlify/functions/_shared/cloud-storage-purge.ts).
-- not_before: when a row may be removed. Upload reservations get an hour; everything else is due now.
ALTER TABLE cloud_storage_purge_queue
  ADD COLUMN not_before timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN last_error text;

-- Rows queued before this change can't be told apart from uploads still under way: give them the hour.
UPDATE cloud_storage_purge_queue SET not_before = queued_at + interval '1 hour';

CREATE INDEX cloud_storage_purge_queue_due ON cloud_storage_purge_queue (not_before);

-- Names are looked up on their own when checking whether anything still points at a file.
CREATE UNIQUE INDEX cloud_blobs_storage_key ON cloud_blobs (storage_key) WHERE storage_key IS NOT NULL;

-- Move the old per-file queue over, leaving out files that are still in use. The old table
-- stays, empty and unused, until a later release drops it.
INSERT INTO cloud_storage_purge_queue (user_id, storage_key, queued_at, not_before)
SELECT queue.user_id, 'cloud/' || queue.user_id::text || '/' || queue.blob_sha, queue.queued_at, queue.queued_at + interval '1 hour'
FROM cloud_purge_queue queue
WHERE NOT EXISTS (
  SELECT 1 FROM cloud_blobs blob
  WHERE blob.user_id = queue.user_id AND blob.blob_sha = queue.blob_sha AND blob.storage_key IS NULL
)
ON CONFLICT (storage_key) DO NOTHING;
DELETE FROM cloud_purge_queue;

-- The sweep's lease: one run at a time, freed by itself if a run dies.
ALTER TABLE cloud_storage_sweep_cursor
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN last_pass_completed_at timestamptz;
