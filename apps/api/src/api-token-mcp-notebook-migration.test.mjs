import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";

describe("API token MCP notebook migration", () => {
  test("upgrades full and single-notebook tokens without changing their access", () => {
    const sqlite = new Database(":memory:");
    for (const file of globSync("migrations/*.sql").sort().filter((file) => file < "migrations/0096")) {
      sqlite.exec(readFileSync(file, "utf8"));
    }
    sqlite.query(
      `INSERT INTO api_tokens (id, workspace_id, name, token_hash, scopes_json)
       VALUES ('tok_existing', 'ws_default', 'Existing', 'hash', '["read:memos"]')`,
    ).run();

    sqlite.exec(readFileSync("migrations/0096_api_token_mcp_notebook_scope.sql", "utf8"));

    expect(sqlite.query("SELECT mcp_notebook_id FROM api_tokens WHERE id = 'tok_existing'").get())
      .toEqual({ mcp_notebook_id: null });
    sqlite.query(
      `INSERT INTO api_tokens (id, workspace_id, name, token_hash, scopes_json, mcp_notebook_id)
       VALUES ('tok_scoped', 'ws_default', 'Scoped', 'scoped-hash', '["read:memos"]', 'nb_inbox')`,
    ).run();

    sqlite.exec(readFileSync("migrations/0097_api_token_mcp_notebook_scopes.sql", "utf8"));

    expect(sqlite.query("SELECT id, mcp_scope_mode FROM api_tokens ORDER BY id").all()).toEqual([
      { id: "tok_existing", mcp_scope_mode: "all" },
      { id: "tok_scoped", mcp_scope_mode: "notebooks" },
    ]);
    expect(sqlite.query("SELECT token_id, notebook_id FROM api_token_notebook_scopes").all())
      .toEqual([{ token_id: "tok_scoped", notebook_id: "nb_inbox" }]);
    sqlite.close();
  });
});
