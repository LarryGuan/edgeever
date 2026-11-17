import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { prepareMcpNotebookScopedCall, isMcpToolAvailableForAuth } from "./mcp-notebook-scope.ts";

class Statement {
  constructor(sqlite, sql, bindings = []) { this.sqlite = sqlite; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.query(this.sql).get(...this.bindings) ?? null; }
}

const fixture = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE memos (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, notebook_id TEXT NOT NULL);`);
  sqlite.query("INSERT INTO memos VALUES (?, ?, ?)").run("memo_allowed", "ws_1", "nb_allowed");
  sqlite.query("INSERT INTO memos VALUES (?, ?, ?)").run("memo_other", "ws_1", "nb_other");
  const database = { prepare: (sql) => new Statement(sqlite, sql) };
  const auth = {
    kind: "agent", actorType: "agent", actorId: "tok_1", username: "Scoped", displayName: null,
    scopes: ["read:memos", "write:memos"], workspaceId: "ws_1", role: "member", mcpNotebookId: "nb_allowed",
  };
  return { sqlite, database, auth };
};

describe("MCP notebook scope", () => {
  test("forces searches and lists into the configured notebook", async () => {
    const { sqlite, database, auth } = fixture();
    expect(await prepareMcpNotebookScopedCall(database, auth, "search_memos", { query: "plan" }))
      .toEqual({ query: "plan", notebookId: "nb_allowed" });
    await expect(prepareMcpNotebookScopedCall(database, auth, "list_memos", { notebookId: "nb_other" }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    sqlite.close();
  });

  test("allows direct and batch access only when every memo is in scope", async () => {
    const { sqlite, database, auth } = fixture();
    expect(await prepareMcpNotebookScopedCall(database, auth, "get_memo", { memoId: "memo_allowed" }))
      .toEqual({ memoId: "memo_allowed" });
    await expect(prepareMcpNotebookScopedCall(database, auth, "get_memo", { memoId: "memo_other" }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(prepareMcpNotebookScopedCall(database, auth, "trash_memos", { memoIds: ["memo_allowed", "memo_other"] }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    sqlite.close();
  });

  test("fails closed for workspace-wide tools and keeps old tokens unchanged", async () => {
    const { sqlite, database, auth } = fixture();
    expect(isMcpToolAvailableForAuth(auth, "get_workspace_stats")).toBe(false);
    await expect(prepareMcpNotebookScopedCall(database, auth, "get_workspace_stats", {}))
      .rejects.toMatchObject({ code: "forbidden", status: 403 });
    const fullAuth = { ...auth, mcpNotebookId: null };
    expect(await prepareMcpNotebookScopedCall(database, fullAuth, "get_workspace_stats", { any: true }))
      .toEqual({ any: true });
    sqlite.close();
  });
});
