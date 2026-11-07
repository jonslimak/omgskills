-- Agents a person connected to My skills (the library MCP), one row per OAuth client.
-- Disconnecting sets blocked_at; that agent is refused until the person allows it again.

CREATE TABLE library_agent_connections (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  first_used_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  blocked_at timestamptz,
  PRIMARY KEY (user_id, client_id),
  CONSTRAINT library_agent_connections_client_id_check CHECK (char_length(client_id) BETWEEN 1 AND 500)
);
