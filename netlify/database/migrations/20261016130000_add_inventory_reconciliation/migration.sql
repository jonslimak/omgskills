ALTER TABLE device_tokens
  ADD COLUMN inventory_revision uuid,
  ADD COLUMN inventory_protocol integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT device_tokens_inventory_protocol_check CHECK (inventory_protocol IN (1, 2, 3));

ALTER TABLE sync_runs ADD COLUMN scan_coverage jsonb;
