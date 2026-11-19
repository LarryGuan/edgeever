import { describe, expect, test } from "bun:test";
import {
  buildFileDocumentFilename,
  resolveFileDocumentPreviewer,
  splitFileDocumentFilename,
} from "./file-document-presentation.ts";

describe("file document presentation", () => {
  test("selects the existing built-in previewers before the download fallback", () => {
    expect(resolveFileDocumentPreviewer({ filename: "report.bin", mimeType: "application/pdf" }).kind).toBe("pdf");
    expect(resolveFileDocumentPreviewer({ filename: "photo.png", mimeType: "image/png" }).kind).toBe("image");
    expect(resolveFileDocumentPreviewer({ filename: "voice.mp3", mimeType: "audio/mpeg" }).kind).toBe("audio");
    expect(resolveFileDocumentPreviewer({ filename: "clip.mp4", mimeType: "video/mp4" }).kind).toBe("video");
    expect(resolveFileDocumentPreviewer({ filename: "proposal.DOCX", mimeType: null }).kind).toBe("docx");
    expect(resolveFileDocumentPreviewer({ filename: "dashboard.HTML", mimeType: null }).kind).toBe("html");
    expect(resolveFileDocumentPreviewer({ filename: "page.bin", mimeType: "text/html" }).kind).toBe("html");
    expect(resolveFileDocumentPreviewer({ filename: "table.xlsx", mimeType: null }).kind).toBe("download");
  });

  test("renames only the stem and preserves the original extension", () => {
    expect(splitFileDocumentFilename("report.final.pdf")).toEqual({ stem: "report.final", extension: ".pdf" });
    expect(splitFileDocumentFilename("README")).toEqual({ stem: "README", extension: "" });
    expect(buildFileDocumentFilename("report.pdf", " 2026/summary.docx ")).toBe("2026-summary.docx.pdf");
    expect(buildFileDocumentFilename("report.pdf", "   ")).toBe("");
  });
});
