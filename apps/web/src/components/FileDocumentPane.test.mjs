import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./FileDocumentPane.tsx", import.meta.url), "utf8");

describe("file document shell", () => {
  test("reuses note metadata controls without coupling the note title to the resource filename", () => {
    expect(source).toContain("<MemoTitleInput");
    expect(source).toContain("<MemoEditorMetadataRow");
    expect(source).toContain("<ShareMemoDialog");
    expect(source).toContain("repository.renameResource");
    expect(source).toContain("repository.updateMemo");
    expect(source).not.toContain("title: filename");
  });

  test("keeps the file toolbar outside the full-height preview body", () => {
    const toolbar = source.indexOf("<AttachmentFileIcon");
    const preview = source.indexOf("<FileDocumentPreview");
    expect(toolbar).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(toolbar);
    expect(source).toContain('className="min-h-0 flex-1 overflow-hidden"');
  });
});
