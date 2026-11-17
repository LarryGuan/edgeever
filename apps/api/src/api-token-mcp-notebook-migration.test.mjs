import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";

describe("API token MCP notebook migration", () => {
  test("upgrades existing tokens without changing their access", () => {
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
    sqlite.query("UPDATE api_tokens SET mcp_notebook_id = 'nb_inbox' WHERE id = 'tok_existing'").run();
    expect(sqlite.query("SELECT mcp_notebook_id FROM api_tokens WHERE id = 'tok_existing'").get())
      .toEqual({ mcp_notebook_id: "nb_inbox" });
    sqlite.close();
  });
});
