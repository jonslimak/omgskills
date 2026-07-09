CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  display_name text,
  handle text UNIQUE,
  handle_updated_at timestamptz,
  profile_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  slug text NOT NULL,
  visibility text NOT NULL DEFAULT 'private',
  is_favorites boolean NOT NULL DEFAULT false,
  show_owner_name boolean NOT NULL DEFAULT false,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_groups_owner_slug_unique UNIQUE (owner_user_id, slug),
  CONSTRAINT skill_groups_visibility_check CHECK (visibility IN ('private', 'restricted', 'public'))
);

CREATE INDEX IF NOT EXISTS skill_groups_owner_idx ON skill_groups(owner_user_id);
CREATE INDEX IF NOT EXISTS skill_groups_visibility_idx ON skill_groups(visibility);

CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT sync_runs_status_check CHECK (status IN ('started', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS sync_runs_user_idx ON sync_runs(user_id);

CREATE TABLE IF NOT EXISTS synced_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sync_run_id uuid NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  stable_key text NOT NULL,
  name text NOT NULL,
  description text,
  catalog_skill_id text,
  github_url text,
  is_local_only boolean NOT NULL DEFAULT false,
  source text NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT synced_skills_user_stable_key_unique UNIQUE (user_id, stable_key)
);

CREATE INDEX IF NOT EXISTS synced_skills_user_current_idx ON synced_skills(user_id, is_current);

CREATE TABLE IF NOT EXISTS skill_group_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES skill_groups(id) ON DELETE CASCADE,
  kind text NOT NULL,
  synced_skill_id uuid REFERENCES synced_skills(id) ON DELETE SET NULL,
  catalog_skill_id text,
  github_url text,
  note text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_group_items_kind_check CHECK (kind IN ('synced', 'catalog', 'github'))
);

CREATE INDEX IF NOT EXISTS skill_group_items_group_position_idx ON skill_group_items(group_id, position);

CREATE TABLE IF NOT EXISTS skill_group_allowed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES skill_groups(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_group_allowed_emails_group_email_unique UNIQUE (group_id, email)
);

CREATE INDEX IF NOT EXISTS skill_group_allowed_emails_email_idx ON skill_group_allowed_emails(email);

CREATE TABLE IF NOT EXISTS skill_group_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  new_group_id uuid NOT NULL REFERENCES skill_groups(id) ON DELETE CASCADE,
  source_group_id uuid REFERENCES skill_groups(id) ON DELETE SET NULL,
  source_owner_handle text,
  source_group_slug text,
  source_owner_display_name text,
  copied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_tokens_user_idx ON sync_tokens(user_id);

CREATE TABLE IF NOT EXISTS analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  group_id uuid REFERENCES skill_groups(id) ON DELETE SET NULL,
  profile_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  skill_item_id uuid REFERENCES skill_group_items(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_name_created_idx ON analytics_events(event_name, created_at);
