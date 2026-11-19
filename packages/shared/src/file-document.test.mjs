import { describe, expect, test } from "bun:test";
import {
  fileDocumentResourceId,
  inferFileDocumentFormatKey,
  parseFileDocument,
  resolveDocumentDescriptor,
  serializeFileDocumentMarker,
  stripFileDocumentMarker,
} from "./index.ts";

describe("file document contract", () => {
  test("round-trips a primary file marker without treating its fallback as editable Markdown", () => {
    const marker = serializeFileDocumentMarker({
      formatKey: "d2",
      resourceUrl: "/api/v1/resources/res_d2/blob",
    });
    const markdown = `${marker}\n\n[附件：system.d2](/api/v1/resources/res_d2/blob)`;

    expect(parseFileDocument(markdown)).toEqual({
      formatKey: "d2",
      resourceUrl: "/api/v1/resources/res_d2/blob",
    });
    expect(fileDocumentResourceId(parseFileDocument(markdown))).toBe("res_d2");
    expect(stripFileDocumentMarker(markdown)).toBe("[附件：system.d2](/api/v1/resources/res_d2/blob)");
    expect(resolveDocumentDescriptor(markdown)).toEqual({
      storageMode: "resource",
      formatKey: "d2",
      primaryResourceId: "res_d2",
      capabilities: {
        preview: false,
        edit: false,
        download: true,
        searchContent: false,
        export: false,
      },
    });
  });

  test("recognizes common files and leaves normal Markdown on the existing path", () => {
    expect(inferFileDocumentFormatKey("system.d2", "text/plain")).toBe("d2");
    expect(inferFileDocumentFormatKey("report.pdf", "application/pdf")).toBe("pdf");
    expect(inferFileDocumentFormatKey("unknown.bin", "application/octet-stream")).toBe("generic-file");
    expect(resolveDocumentDescriptor("# normal note")).toMatchObject({ storageMode: "inline", formatKey: "markdown" });
  });
});
