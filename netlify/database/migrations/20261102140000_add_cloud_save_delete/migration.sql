-- Cloud save: users can delete what they saved. Versions stay append-only for every
-- other purpose; only a transaction that sets omgskills.cloud_purge may delete, and
-- only rows belonging to 'cloud' sources.

CREATE OR REPLACE FUNCTION reject_skill_release_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Separate checks: OLD has different columns on each table this guards.
  IF TG_OP = 'DELETE' AND current_setting('omgskills.cloud_purge', true) = 'on' THEN
    IF TG_TABLE_NAME IN ('cloud_releases', 'cloud_release_files') THEN
      RETURN OLD;
    END IF;
    IF TG_TABLE_NAME = 'skill_releases' THEN
      IF EXISTS (SELECT 1 FROM skill_sources WHERE id = OLD.source_id AND kind = 'cloud') THEN
        RETURN OLD;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'skill releases are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION reject_skill_source_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.kind = 'cloud' AND current_setting('omgskills.cloud_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'skill sources must be tombstoned, not deleted' USING ERRCODE = '55000';
END;
$$;

-- Stored files still to remove from object storage after their records were deleted.
CREATE TABLE cloud_purge_queue (
  user_id uuid NOT NULL,
  blob_sha text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blob_sha),
  CONSTRAINT cloud_purge_queue_sha_check CHECK (blob_sha ~ '^[0-9a-f]{40}$')
);
