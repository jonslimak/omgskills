-- Install acks: the Mac app tells the server it received a website install request, so the install pop-over can
-- say "Approve it in omgskills." Rows matter only while a pop-over polls; each new ack trims the person's rows to
-- the newest 20 from the last hour.

CREATE TABLE install_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
  catalog_id text NOT NULL,
  agent text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT install_acks_catalog_id_check CHECK (octet_length(catalog_id) BETWEEN 1 AND 500),
  CONSTRAINT install_acks_agent_check CHECK (agent IN ('claude', 'codex'))
);

CREATE INDEX install_acks_user_received_idx ON install_acks(user_id, received_at);
