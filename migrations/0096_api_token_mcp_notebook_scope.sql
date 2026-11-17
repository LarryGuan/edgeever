ALTER TABLE api_tokens ADD COLUMN mcp_notebook_id TEXT;

CREATE INDEX idx_api_tokens_mcp_notebook
  ON api_tokens(workspace_id, mcp_notebook_id)
  WHERE mcp_notebook_id IS NOT NULL;
