-- Cloud save: users' own skills stored as versioned releases of a 'cloud' source.
-- File contents live in a private object store keyed by user and git blob hash.

-- Devices may hold content:write, which lets them upload skills to cloud save.
ALTER TABLE sync_tokens
  DROP CONSTRAINT sync_tokens_granted_scopes_check,
  ADD CONSTRAINT sync_tokens_granted_scopes_check
    CHECK (
      granted_scopes <@ ARRAY['sync:write', 'self:revoke', 'content:read', 'content:write']::text[]
      AND granted_scopes @> ARRAY['sync:write', 'self:revoke']::text[]
    );

ALTER TABLE device_tokens
  DROP CONSTRAINT device_tokens_granted_scopes_check,
  ADD CONSTRAINT device_tokens_granted_scopes_check
    CHECK (
      granted_scopes <@ ARRAY['sync:write', 'self:revoke', 'content:read', 'content:write']::text[]
      AND granted_scopes @> ARRAY['sync:write', 'self:revoke']::text[]
    );

ALTER TABLE skill_sources
  DROP CONSTRAINT skill_sources_kind_check,
  ADD CONSTRAINT skill_sources_kind_check
    CHECK (kind IN ('catalog', 'public_github', 'private_github', 'cloud')),
  DROP CONSTRAINT skill_sources_shape_check,
  ADD CONSTRAINT skill_sources_shape_check
    CHECK (
      (
        kind = 'catalog'
        AND catalog_skill_id IS NOT NULL
        AND repository_id IS NULL
        AND repository_slug IS NULL
        AND owner_user_id IS NULL
        AND broker_installation_id IS NULL
      ) OR (
        kind = 'public_github'
        AND catalog_skill_id IS NULL
        AND repository_id IS NOT NULL
        AND repository_slug IS NOT NULL
        AND owner_user_id IS NULL
        AND broker_installation_id IS NULL
      ) OR (
        kind = 'private_github'
        AND catalog_skill_id IS NULL
        AND repository_id IS NOT NULL
        AND repository_slug IS NOT NULL
        AND owner_user_id IS NOT NULL
        AND broker_installation_id IS NOT NULL
      ) OR (
        kind = 'cloud'
        AND catalog_skill_id IS NULL
        AND repository_id IS NULL
        AND repository_slug IS NULL
        AND owner_user_id IS NOT NULL
        AND broker_installation_id IS NULL
      )
    );

CREATE UNIQUE INDEX skill_sources_cloud_unique
  ON skill_sources(owner_user_id, normalized_root)
  WHERE kind = 'cloud';

CREATE TABLE cloud_save_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  excluded_skill_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cloud_save_settings_exclusions_check
    CHECK (cardinality(excluded_skill_keys) <= 5000)
);

CREATE TABLE cloud_blobs (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blob_sha text NOT NULL,
  byte_size integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blob_sha),
  CONSTRAINT cloud_blobs_sha_check CHECK (blob_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT cloud_blobs_size_check CHECK (byte_size >= 0)
);

CREATE TABLE cloud_releases (
  release_id uuid PRIMARY KEY,
  source_id uuid NOT NULL,
  -- A record of the Mac that saved the version, not a reference: versions are append-only.
  device_id uuid,
  file_count integer NOT NULL,
  total_bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (release_id, source_id) REFERENCES skill_releases(id, source_id) ON DELETE RESTRICT,
  CONSTRAINT cloud_releases_size_check CHECK (file_count > 0 AND total_bytes >= 0)
);

CREATE TABLE cloud_release_files (
  release_id uuid NOT NULL REFERENCES cloud_releases(release_id) ON DELETE RESTRICT,
  path text NOT NULL,
  mode text NOT NULL,
  blob_sha text NOT NULL,
  byte_size integer NOT NULL,
  PRIMARY KEY (release_id, path),
  CONSTRAINT cloud_release_files_mode_check CHECK (mode IN ('100644', '100755')),
  CONSTRAINT cloud_release_files_sha_check CHECK (blob_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT cloud_release_files_size_check CHECK (byte_size >= 0)
);

CREATE TRIGGER cloud_releases_append_only
  BEFORE UPDATE OR DELETE ON cloud_releases
  FOR EACH ROW EXECUTE FUNCTION reject_skill_release_mutation();

CREATE TRIGGER cloud_release_files_append_only
  BEFORE UPDATE OR DELETE ON cloud_release_files
  FOR EACH ROW EXECUTE FUNCTION reject_skill_release_mutation();

CREATE TABLE cloud_saved_skills (
  source_id uuid PRIMARY KEY REFERENCES skill_sources(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  skill_key text NOT NULL,
  current_release_id uuid NOT NULL,
  deleted_locally_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (current_release_id, source_id) REFERENCES skill_releases(id, source_id) ON DELETE RESTRICT,
  CONSTRAINT cloud_saved_skills_user_key_unique UNIQUE (user_id, skill_key)
);
