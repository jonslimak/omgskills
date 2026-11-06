-- Public catalog skills a person added to My skills without installing them.
-- A private reference list, separate from Favorites (a public Set). Catalog ids only.

CREATE TABLE my_skill_additions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_skill_id text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, catalog_skill_id),
  CONSTRAINT my_skill_additions_catalog_skill_id_check CHECK (char_length(catalog_skill_id) BETWEEN 1 AND 500)
);
