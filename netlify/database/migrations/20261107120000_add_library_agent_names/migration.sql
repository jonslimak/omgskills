-- The agent's name for clients that register themselves (DCR), looked up once; '' means not found.
ALTER TABLE library_agent_connections ADD COLUMN client_name text;
ALTER TABLE library_agent_connections
  ADD CONSTRAINT library_agent_connections_client_name_check CHECK (client_name IS NULL OR char_length(client_name) <= 200);
