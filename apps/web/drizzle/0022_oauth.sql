-- OAuth 2.1 authorization server — lets claude.ai (and other remote MCP
-- connectors that require the OAuth handshake) connect to the Aeon MCP server.
--
-- Flow backed by these tables: Dynamic Client Registration -> authorization
-- code (PKCE, S256) -> access + refresh tokens. Static aeon_k1_ API keys are
-- unaffected and continue to work in parallel.

CREATE TABLE IF NOT EXISTS oauth_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name   varchar(255),
  redirect_uris jsonb NOT NULL,
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash      varchar(64) NOT NULL UNIQUE,
  client_id      uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge varchar(128) NOT NULL,
  scope          varchar(255) NOT NULL DEFAULT 'mcp',
  resource       text,
  expires_at     timestamp NOT NULL,
  used_at        timestamp,
  created_at     timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash         varchar(64) NOT NULL UNIQUE,
  token_prefix       varchar(12) NOT NULL,
  refresh_hash       varchar(64) UNIQUE,
  client_id          uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope              varchar(255) NOT NULL DEFAULT 'mcp',
  expires_at         timestamp NOT NULL,
  refresh_expires_at timestamp,
  revoked_at         timestamp,
  last_used_at       timestamp,
  created_at         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_access_tokens_user_idx
  ON oauth_access_tokens (user_id);
