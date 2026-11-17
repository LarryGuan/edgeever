import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchEdgeEverApp } from "./index.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

const fixtures = [];
const executionContext = { waitUntil() {}, passThroughOnException() {} };

afterEach(async () => {
  for (const { database, directory } of fixtures.splice(0)) {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-token-scope-"));
  const database = new Database(":memory:");
  fixtures.push({ database, directory });
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../../../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  database.run("INSERT OR IGNORE INTO workspaces (id, name, is_personal) VALUES ('ws_default', 'Personal', 1)");
  database.run("INSERT INTO notebooks (id, workspace_id, name) VALUES ('scope_parent', 'ws_default', 'Parent')");
  database.run("INSERT INTO notebooks (id, workspace_id, parent_id, name) VALUES ('scope_child', 'ws_default', 'scope_parent', 'Child')");
  database.run("INSERT INTO notebooks (id, workspace_id, name) VALUES ('scope_other', 'ws_default', 'Other')");
  database.run("INSERT INTO workspaces (id, name, is_personal) VALUES ('ws_other_scope', 'Other', 1)");
  database.run("INSERT INTO notebooks (id, workspace_id, name) VALUES ('scope_foreign', 'ws_other_scope', 'Foreign')");
  const environment = {
    storage: createSelfHostedStorageAdapter(database, directory),
    EDGE_EVER_ALLOW_UNAUTHENTICATED: "true",
    EDGE_EVER_RUNTIME: "self-hosted-bun",
  };
  const request = (path, init = {}) => fetchEdgeEverApp(
    new Request(`http://edgeever.test${path}`, init),
    environment,
    executionContext,
  );
  const json = (method, body, token) => ({
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { database, request, json };
};

describe("API token notebook scopes", () => {
  test("normalizes parent selections and edits an existing token without rotating it", async () => {
    const f = await fixture();
    const createdResponse = await f.request("/api/v1/api-tokens", f.json("POST", {
      name: "Scoped",
      scopes: ["read:memos"],
      mcpScopeMode: "notebooks",
      mcpNotebookIds: ["scope_child", "scope_parent", "scope_other"],
    }));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.apiToken).toMatchObject({ mcpScopeMode: "notebooks", mcpNotebookId: null });
    expect(new Set(created.apiToken.mcpNotebookIds)).toEqual(new Set(["scope_parent", "scope_other"]));
    expect(f.database.query("SELECT mcp_notebook_id FROM api_tokens WHERE id = ?").get(created.apiToken.id))
      .toEqual({ mcp_notebook_id: "__mcp_multiple_notebooks__" });

    const updatedResponse = await f.request(`/api/v1/api-tokens/${created.apiToken.id}`, f.json("PATCH", {
      mcpScopeMode: "notebooks",
      mcpNotebookIds: ["scope_child"],
    }));
    expect(updatedResponse.status).toBe(200);
    const updated = await updatedResponse.json();
    expect(updated.apiToken).toMatchObject({
      token: created.token,
      mcpScopeMode: "notebooks",
      mcpNotebookIds: ["scope_child"],
      mcpNotebookId: "scope_child",
    });
    expect(f.database.query("SELECT notebook_id FROM api_token_notebook_scopes WHERE token_id = ?").all(created.apiToken.id))
      .toEqual([{ notebook_id: "scope_child" }]);

    const invalid = await f.request(`/api/v1/api-tokens/${created.apiToken.id}`, f.json("PATCH", {
      mcpScopeMode: "notebooks",
      mcpNotebookIds: ["scope_foreign"],
    }));
    expect(invalid.status).toBe(400);
    expect(f.database.query("SELECT notebook_id FROM api_token_notebook_scopes WHERE token_id = ?").all(created.apiToken.id))
      .toEqual([{ notebook_id: "scope_child" }]);
  });
});
