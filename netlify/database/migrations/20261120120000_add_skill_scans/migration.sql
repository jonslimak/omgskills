-- Scan results, one row per skill content (its folder's git tree) and scanner version: the same
-- content is scanned once per scanner version, whoever saved it. Findings name the rule, file and
-- line, never the matched text. Partial or failed never counts as clean.
CREATE TABLE skill_scans (
  tree_sha text NOT NULL,
  scanner text NOT NULL,
  scanner_version text NOT NULL,
  status text NOT NULL,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  files_scanned integer NOT NULL DEFAULT 0,
  files_skipped integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tree_sha, scanner, scanner_version),
  CONSTRAINT skill_scans_tree_sha_check CHECK (tree_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT skill_scans_scanner_check CHECK (scanner ~ '^[a-z0-9][a-z0-9-]{0,62}$'
    AND char_length(scanner_version) BETWEEN 1 AND 64),
  CONSTRAINT skill_scans_status_check CHECK (status IN ('complete', 'partial', 'failed')),
  CONSTRAINT skill_scans_findings_check CHECK (jsonb_typeof(findings) = 'array'),
  CONSTRAINT skill_scans_counts_check CHECK (files_scanned >= 0 AND files_skipped >= 0)
);

-- Private skill versions waiting to be scanned. A version is the place to read the files from;
-- the scanners to run are chosen when the job runs. Same lease pattern as the storage purge queue.
CREATE TABLE scan_jobs (
  release_id uuid PRIMARY KEY REFERENCES skill_releases(id) ON DELETE CASCADE,
  tree_sha text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  not_before timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  lease_token uuid,
  lease_until timestamptz,
  CONSTRAINT scan_jobs_tree_sha_check CHECK (tree_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT scan_jobs_attempts_check CHECK (attempts >= 0)
);

CREATE INDEX scan_jobs_due_idx ON scan_jobs(not_before, queued_at);

-- Finds every version with the same content, so a scan's results go when the last one does.
CREATE INDEX skill_releases_tree_sha_idx ON skill_releases(tree_sha);

-- Every private version saved so far, in the order they were saved.
INSERT INTO scan_jobs (release_id, tree_sha, queued_at)
SELECT release.id, release.tree_sha, release.created_at
FROM skill_releases release
JOIN skill_sources source ON source.id = release.source_id
WHERE source.kind IN ('cloud', 'private_github')
  AND source.tombstoned_at IS NULL;
