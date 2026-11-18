import { expect, test } from "bun:test";
import { parseFileDocument } from "@edgeever/shared";
import { createSharedFileMemo } from "./shared-file-import.ts";

test("a non-Markdown import preserves its machine-readable primary file marker", async () => {
  const original = {
    id: "memo",
    revision: 1,
    contentHash: "hash",
    title: "",
    tags: [],
    contentMarkdown: "",
  };
  const result = await createSharedFileMemo({
    notebookId: "notebook",
    filename: "system.d2",
    file: new File(["direction: right"], "system.d2", { type: "text/plain" }),
    createMemo: async (input) => ({ memo: { ...original, title: input.title } }),
    uploadResource: async () => ({
      url: "/api/v1/resources/resource/blob",
      filename: "system.d2",
    }),
    updateMemo: async (memo, content) => ({ memo: { ...memo, contentMarkdown: content.contentMarkdown } }),
  });

  expect(parseFileDocument(result.contentMarkdown)).toEqual({
    formatKey: "d2",
    resourceUrl: "/api/v1/resources/resource/blob",
  });
  expect(result.contentMarkdown).toContain("[附件：system.d2](/api/v1/resources/resource/blob)");
  expect(result.contentMarkdown).not.toContain("&lt;!--");
});
