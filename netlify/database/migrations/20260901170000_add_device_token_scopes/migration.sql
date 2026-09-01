ALTER TABLE sync_tokens
  ADD COLUMN granted_scopes text[] NOT NULL
    DEFAULT ARRAY['sync:write', 'self:revoke']::text[],
  ADD CONSTRAINT sync_tokens_granted_scopes_check
    CHECK (
      granted_scopes <@ ARRAY['sync:write', 'self:revoke', 'content:read']::text[]
      AND granted_scopes @> ARRAY['sync:write', 'self:revoke']::text[]
    );

ALTER TABLE device_tokens
  ADD COLUMN granted_scopes text[] NOT NULL
    DEFAULT ARRAY['sync:write', 'self:revoke']::text[],
  ADD CONSTRAINT device_tokens_granted_scopes_check
    CHECK (
      granted_scopes <@ ARRAY['sync:write', 'self:revoke', 'content:read']::text[]
      AND granted_scopes @> ARRAY['sync:write', 'self:revoke']::text[]
    );
