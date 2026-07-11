UPDATE synced_skills
SET catalog_skill_id = NULL
WHERE catalog_skill_id IS NOT NULL
  AND btrim(catalog_skill_id) = '';

-- Existing catalog IDs predate identity_status, so preserve that stronger evidence.
UPDATE synced_skills
SET identity_status = 'resolved',
    is_local_only = false
WHERE catalog_skill_id IS NOT NULL;

UPDATE synced_skills
SET identity_status = 'ambiguous',
    is_local_only = false
WHERE catalog_skill_id IS NULL
  AND identity_status = 'resolved';

UPDATE synced_skills
SET is_local_only = (identity_status = 'localOnly')
WHERE is_local_only IS DISTINCT FROM (identity_status = 'localOnly');

ALTER TABLE synced_skills
  ADD CONSTRAINT synced_skills_identity_consistency_check
  CHECK (
    (identity_status = 'resolved' AND catalog_skill_id IS NOT NULL AND is_local_only = false)
    OR (identity_status = 'ambiguous' AND catalog_skill_id IS NULL AND is_local_only = false)
    OR (identity_status = 'localOnly' AND catalog_skill_id IS NULL AND is_local_only = true)
  );
