CREATE TABLE github_broker_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  installation_id text NOT NULL,
  account_id text NOT NULL,
  account_login text NOT NULL,
  account_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT github_broker_installations_values_check
    CHECK (
      char_length(installation_id) BETWEEN 1 AND 100
      AND installation_id = btrim(installation_id)
      AND installation_id ~ '^[0-9]+$'
      AND char_length(account_id) BETWEEN 1 AND 100
      AND account_id = btrim(account_id)
      AND account_id ~ '^[0-9]+$'
      AND char_length(account_login) BETWEEN 1 AND 255
      AND account_login = btrim(account_login)
      AND account_type IN ('User', 'Organization')
    ),
  CONSTRAINT github_broker_installations_installation_unique UNIQUE (installation_id),
  CONSTRAINT github_broker_installations_owner_installation_unique
    UNIQUE (owner_user_id, installation_id)
);

CREATE INDEX github_broker_installations_owner_idx
  ON github_broker_installations(owner_user_id);

ALTER TABLE skill_sources
  DROP CONSTRAINT skill_sources_root_check,
  ADD CONSTRAINT skill_sources_root_check
    CHECK (
      char_length(normalized_root) BETWEEN 1 AND 1000
      AND normalized_root = btrim(normalized_root)
      AND normalized_root NOT LIKE '/%'
      AND normalized_root NOT LIKE '%/'
      AND normalized_root NOT LIKE '%//%'
      AND strpos(normalized_root, chr(92)) = 0
      AND normalized_root !~ '[[:cntrl:]]'
      AND (
        normalized_root = '.'
        OR normalized_root !~ '(^|/)\.{1,2}(/|$)'
      )
    );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM skill_sources source
    LEFT JOIN github_broker_installations installation
      ON installation.owner_user_id = source.owner_user_id
      AND installation.installation_id = source.broker_installation_id
    WHERE source.kind = 'private_github'
      AND installation.installation_id IS NULL
  ) THEN
    RAISE EXCEPTION 'private GitHub sources require an owner installation binding';
  END IF;
END;
$$;

ALTER TABLE skill_sources
  ADD CONSTRAINT skill_sources_owner_broker_installation_fk
  FOREIGN KEY (owner_user_id, broker_installation_id)
  REFERENCES github_broker_installations(owner_user_id, installation_id)
  ON DELETE RESTRICT;
