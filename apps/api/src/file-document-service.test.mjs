import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { serializeFileDocumentMarker } from "@edgeever/shared";
import { createMemoRecord, updateMemoRecord } from "./memo-service.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

const databases = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

const setup = async () => {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  sqlite.exec(`
    INSERT INTO workspaces(id, name) VALUES ('workspace', 'Workspace');
    INSERT INTO notebooks(id, workspace_id, name) VALUES ('notebook', 'workspace', 'Notebook');
  `);
  const db = createSelfHostedStorageAdapter(sqlite, "/tmp/file-document-service-unused").db;
  const actor = { actorType: "user", actorId: "owner" };
  const memo = await createMemoRecord(db, "workspace", {
    notebookId: "notebook",
    title: "System diagram",
    contentMarkdown: "",
    tags: [],
  }, actor, "owner");
  sqlite.query(`INSERT INTO resources
    (id, memo_id, object_key, kind, filename, mime_type, byte_size, sha256)
    VALUES ('resource', ?, 'resource-key', 'attachment', 'system.d2', 'text/plain', 3, 'abc')`).run(memo.id);
  return { sqlite, db, actor, memo };
};

test("a file marker promotes its owned resource and cannot be replaced by Markdown", async () => {
  const fixture = await setup();
  const marker = serializeFileDocumentMarker({
    formatKey: "d2",
    resourceUrl: "/api/v1/resources/resource/blob",
  });
  const updated = await updateMemoRecord(
    fixture.db,
    "workspace",
    fixture.memo.id,
    { contentMarkdown: `${marker}\n\n[附件：system.d2](/api/v1/resources/resource/blob)` },
    fixture.actor,
    "owner",
  );
  expect(updated.memo.document).toMatchObject({ storageMode: "resource", formatKey: "d2", primaryResourceId: "resource" });
  expect(fixture.sqlite.query("SELECT role, format_key FROM resources WHERE id = 'resource'").get()).toEqual({
    role: "primary",
    format_key: "d2",
  });

  const rejected = await updateMemoRecord(
    fixture.db,
    "workspace",
    fixture.memo.id,
    { contentMarkdown: "plain Markdown" },
    fixture.actor,
    "owner",
  );
  expect(rejected).toEqual({
    error: "file_document_update_required",
    message: "File source must be edited on a supported client.",
    status: 409,
  });
});

test("a file marker cannot claim another note's resource", async () => {
  const fixture = await setup();
  fixture.sqlite.exec(`
    INSERT INTO memos(id, notebook_id, workspace_id) VALUES ('other', 'notebook', 'workspace');
    INSERT INTO memo_contents(memo_id, content_json, content_hash) VALUES ('other', '{}', 'hash');
    INSERT INTO resources(id, memo_id, object_key, kind) VALUES ('other_resource', 'other', 'other-key', 'attachment');
  `);
  const marker = serializeFileDocumentMarker({
    formatKey: "generic-file",
    resourceUrl: "/api/v1/resources/other_resource/blob",
  });
  const result = await updateMemoRecord(
    fixture.db,
    "workspace",
    fixture.memo.id,
    { contentMarkdown: marker },
    fixture.actor,
    "owner",
  );
  expect(result).toMatchObject({ error: "invalid_file_document", status: 400 });
});
