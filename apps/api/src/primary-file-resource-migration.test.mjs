import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";

const databases = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

test("primary resource migration preserves attachments and enforces one active primary per note", () => {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  const migrations = globSync("migrations/*.sql").sort();
  for (const file of migrations.filter((file) => file < "migrations/0098")) {
    sqlite.exec(readFileSync(file, "utf8"));
  }
  sqlite.exec(`
    INSERT INTO workspaces(id, name) VALUES ('workspace', 'Workspace');
    INSERT INTO notebooks(id, workspace_id, name) VALUES ('notebook', 'workspace', 'Notebook');
    INSERT INTO memos(id, notebook_id, workspace_id) VALUES ('memo', 'notebook', 'workspace');
    INSERT INTO resources(id, memo_id, object_key, kind) VALUES ('old_attachment', 'memo', 'old', 'attachment');
  `);

  sqlite.exec(readFileSync("migrations/0098_primary_file_resources.sql", "utf8"));
  expect(sqlite.query("SELECT role, format_key FROM resources WHERE id = 'old_attachment'").get()).toEqual({
    role: "attachment",
    format_key: null,
  });

  sqlite.exec(`
    INSERT INTO resources(id, memo_id, object_key, kind, role, format_key)
    VALUES ('primary_one', 'memo', 'one', 'attachment', 'primary', 'd2');
  `);
  let duplicateError = null;
  try {
    sqlite.query(`
      INSERT INTO resources(id, memo_id, object_key, kind, role, format_key)
      VALUES ('primary_two', 'memo', 'two', 'attachment', 'primary', 'pdf')
    `).run();
  } catch (error) {
    duplicateError = error;
  }
  expect(duplicateError).not.toBeNull();
  sqlite.exec("UPDATE resources SET is_deleted = 1 WHERE id = 'primary_one'");
  sqlite.query(`
    INSERT INTO resources(id, memo_id, object_key, kind, role, format_key)
    VALUES ('primary_two', 'memo', 'two', 'attachment', 'primary', 'pdf')
  `).run();
  expect(sqlite.query("SELECT role FROM resources WHERE id = 'primary_two'").get()).toEqual({ role: "primary" });
});
