ALTER TABLE skill_groups
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT skill_groups_revision_check CHECK (revision > 0);

CREATE TABLE skill_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  normalized_root text NOT NULL,
  catalog_skill_id text,
  repository_id text,
  repository_slug text,
  owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  broker_installation_id text,
  tombstoned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_sources_kind_check
    CHECK (kind IN ('catalog', 'public_github', 'private_github')),
  CONSTRAINT skill_sources_root_check
    CHECK (
      char_length(normalized_root) BETWEEN 1 AND 1000
      AND normalized_root = btrim(normalized_root)
      AND normalized_root NOT LIKE '/%'
      AND normalized_root NOT LIKE '%/'
      AND normalized_root NOT LIKE '%//%'
      AND strpos(normalized_root, chr(92)) = 0
    ),
  CONSTRAINT skill_sources_shape_check
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
      )
    )
);

CREATE UNIQUE INDEX skill_sources_catalog_unique
  ON skill_sources(catalog_skill_id)
  WHERE kind = 'catalog';
CREATE UNIQUE INDEX skill_sources_github_unique
  ON skill_sources(kind, repository_id, normalized_root)
  WHERE kind IN ('public_github', 'private_github');
CREATE INDEX skill_sources_owner_idx ON skill_sources(owner_user_id);
CREATE INDEX skill_sources_repository_idx ON skill_sources(repository_id);

CREATE TABLE skill_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES skill_sources(id) ON DELETE RESTRICT,
  commit_sha text NOT NULL,
  tree_sha text NOT NULL,
  skill_md_sha text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_releases_sha_check
    CHECK (
      commit_sha ~ '^[0-9a-f]{40}$'
      AND tree_sha ~ '^[0-9a-f]{40}$'
      AND skill_md_sha ~ '^[0-9a-f]{40}$'
    ),
  CONSTRAINT skill_releases_creator_check
    CHECK (
      char_length(created_by) BETWEEN 1 AND 500
      AND created_by = btrim(created_by)
    ),
  CONSTRAINT skill_releases_source_coordinates_unique
    UNIQUE (source_id, commit_sha, tree_sha, skill_md_sha),
  CONSTRAINT skill_releases_id_source_unique UNIQUE (id, source_id)
);

CREATE INDEX skill_releases_source_created_idx
  ON skill_releases(source_id, created_at);

CREATE FUNCTION reject_skill_release_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'skill releases are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER skill_releases_append_only
  BEFORE UPDATE OR DELETE ON skill_releases
  FOR EACH ROW EXECUTE FUNCTION reject_skill_release_mutation();

CREATE FUNCTION reject_skill_source_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'skill sources must be tombstoned, not deleted' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER skill_sources_no_delete
  BEFORE DELETE ON skill_sources
  FOR EACH ROW EXECUTE FUNCTION reject_skill_source_delete();

ALTER TABLE skill_group_items
  ADD COLUMN source_id uuid REFERENCES skill_sources(id) ON DELETE RESTRICT,
  ADD COLUMN release_id uuid REFERENCES skill_releases(id) ON DELETE RESTRICT,
  ADD COLUMN metadata_only_reason text,
  ADD CONSTRAINT skill_group_items_release_state_check
    CHECK (
      (
        source_id IS NULL
        AND release_id IS NULL
        AND metadata_only_reason IS NULL
      )
      OR (
        source_id IS NOT NULL
        AND release_id IS NOT NULL
        AND metadata_only_reason IS NULL
      )
      OR (
        release_id IS NULL
        AND metadata_only_reason IS NOT NULL
        AND char_length(btrim(metadata_only_reason)) BETWEEN 1 AND 200
      )
    ),
  ADD CONSTRAINT skill_group_items_release_source_fk
    FOREIGN KEY (release_id, source_id)
    REFERENCES skill_releases(id, source_id)
    ON DELETE RESTRICT;

CREATE INDEX skill_group_items_source_idx ON skill_group_items(source_id);
CREATE INDEX skill_group_items_release_idx ON skill_group_items(release_id);
