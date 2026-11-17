import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { prepareMcpNotebookScopedCall, isMcpToolAvailableForAuth, resolveMcpAllowedNotebookIds } from "./mcp-notebook-scope.ts";

class Statement {
  constructor(sqlite, sql, bindings = []) { this.sqlite = sqlite; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.query(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.sqlite.query(this.sql).all(...this.bindings) }; }
}

const fixture = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE notebooks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_id TEXT, is_deleted INTEGER NOT NULL DEFAULT 0);`);
  sqlite.exec(`CREATE TABLE memos (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, notebook_id TEXT NOT NULL);`);
  sqlite.query("INSERT INTO notebooks VALUES (?, ?, ?, 0)").run("nb_allowed", "ws_1", null);
  sqlite.query("INSERT INTO notebooks VALUES (?, ?, ?, 0)").run("nb_child", "ws_1", "nb_allowed");
  sqlite.query("INSERT INTO notebooks VALUES (?, ?, ?, 0)").run("nb_other", "ws_1", null);
  sqlite.query("INSERT INTO memos VALUES (?, ?, ?)").run("memo_allowed", "ws_1", "nb_allowed");
  sqlite.query("INSERT INTO memos VALUES (?, ?, ?)").run("memo_child", "ws_1", "nb_child");
  sqlite.query("INSERT INTO memos VALUES (?, ?, ?)").run("memo_other", "ws_1", "nb_other");
  const database = { prepare: (sql) => new Statement(sqlite, sql) };
  const auth = {
    kind: "agent", actorType: "agent", actorId: "tok_1", username: "Scoped", displayName: null,
    scopes: ["read:memos", "write:memos"], workspaceId: "ws_1", role: "member",
    mcpNotebookScopeMode: "notebooks", mcpNotebookRootIds: ["nb_allowed"],
    mcpAllowedNotebookIds: ["nb_allowed", "nb_child"],
  };
  return { sqlite, database, auth };
};

describe("MCP notebook scope", () => {
  test("allows searches across selected subtrees and rejects other notebooks", async () => {
    const { sqlite, database, auth } = fixture();
    expect(await prepareMcpNotebookScopedCall(database, auth, "search_memos", { query: "plan" }))
      .toEqual({ query: "plan" });
    expect(await prepareMcpNotebookScopedCall(database, auth, "list_memos", { notebookId: "nb_child" }))
      .toEqual({ notebookId: "nb_child" });
    await expect(prepareMcpNotebookScopedCall(database, auth, "list_memos", { notebookId: "nb_other" }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    sqlite.close();
  });

  test("allows direct and batch access only when every memo is in scope", async () => {
    const { sqlite, database, auth } = fixture();
    expect(await prepareMcpNotebookScopedCall(database, auth, "get_memo", { memoId: "memo_allowed" }))
      .toEqual({ memoId: "memo_allowed" });
    expect(await prepareMcpNotebookScopedCall(database, auth, "get_memo", { memoId: "memo_child" }))
      .toEqual({ memoId: "memo_child" });
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
    const fullAuth = { ...auth, mcpNotebookScopeMode: "all", mcpNotebookRootIds: [], mcpAllowedNotebookIds: [] };
    expect(await prepareMcpNotebookScopedCall(database, fullAuth, "get_workspace_stats", { any: true }))
      .toEqual({ any: true });
    sqlite.close();
  });

  test("expands selected parents to current and future descendants", async () => {
    const { sqlite, database } = fixture();
    expect(new Set(await resolveMcpAllowedNotebookIds(database, "ws_1", ["nb_allowed"])))
      .toEqual(new Set(["nb_allowed", "nb_child"]));
    sqlite.query("INSERT INTO notebooks VALUES (?, ?, ?, 0)").run("nb_future", "ws_1", "nb_child");
    expect(new Set(await resolveMcpAllowedNotebookIds(database, "ws_1", ["nb_allowed"])))
      .toEqual(new Set(["nb_allowed", "nb_child", "nb_future"]));
    sqlite.close();
  });
});
