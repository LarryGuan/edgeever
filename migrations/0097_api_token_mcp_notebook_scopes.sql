ALTER TABLE api_tokens
  ADD COLUMN mcp_scope_mode TEXT NOT NULL DEFAULT 'all'
  CHECK (mcp_scope_mode IN ('all', 'notebooks'));

CREATE TABLE api_token_notebook_scopes (
  token_id TEXT NOT NULL,
  notebook_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (token_id, notebook_id),
  FOREIGN KEY (token_id) REFERENCES api_tokens(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

INSERT INTO api_token_notebook_scopes (token_id, notebook_id)
SELECT id, mcp_notebook_id
FROM api_tokens
WHERE mcp_notebook_id IS NOT NULL;

UPDATE api_tokens
SET mcp_scope_mode = 'notebooks'
WHERE mcp_notebook_id IS NOT NULL;

CREATE INDEX idx_api_token_notebook_scopes_notebook
  ON api_token_notebook_scopes(notebook_id, token_id);
