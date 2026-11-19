import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./FileDocumentPane.tsx", import.meta.url), "utf8");
const previewSource = readFileSync(new URL("./file-document/FileDocumentPreview.tsx", import.meta.url), "utf8");
const pdfSource = readFileSync(new URL("./pdf/PdfViewer.tsx", import.meta.url), "utf8");
const infoSource = readFileSync(new URL("./file-document/FileDocumentInfoDialog.tsx", import.meta.url), "utf8");
const docxSource = readFileSync(new URL("./file-document/DocxFileDocumentPreview.tsx", import.meta.url), "utf8");

describe("file document shell", () => {
  test("exposes one editable note title and keeps source-file facts read-only", () => {
    expect(source).toContain("<MemoTitleInput");
    expect(source).toContain("<MemoEditorMetadataRow");
    expect(source).toContain("<ShareMemoDialog");
    expect(source).toContain("repository.updateMemo");
    expect(source).toContain("<FileDocumentInfoDialog");
    expect(source).not.toContain("repository.renameResource");
    expect(source).not.toContain("<FileDocumentRenameDialog");
    expect(source).not.toContain("title: filename");
    expect(infoSource).toContain('t("fileNote.sourceFilename")');
    expect(infoSource).not.toContain("onRename");
  });

  test("uses a left-aligned file toolbar for every preview without a DOCX beta badge", () => {
    expect(source).toContain('t("fileNote.fileInfo")');
    expect(source).toContain('t("fileNote.downloadOriginal")');
    expect(previewSource).toContain("<MemoEditorToolbarRow");
    expect(previewSource).not.toContain("fileNote.previewBeta");
    expect(source).toContain('className="min-h-0 flex-1 overflow-hidden"');
  });

  test("uses PDF file-note chrome without changing the default attachment mode", () => {
    expect(previewSource).toContain('mode="file-note"');
    expect(previewSource).toContain("toolbarLeading={toolbar}");
    expect(pdfSource).toContain('mode?: "attachment" | "file-note"');
    expect(pdfSource).toContain('mode = "attachment"');
    expect(pdfSource).toContain("!fileNoteMode ? <button");
    expect(pdfSource).toContain("!fileNoteMode ? <ButtonTooltip");
    expect(pdfSource).toContain('addEventListener("touchmove"');
    expect(pdfSource).toContain("Math.round(zoom * 100)");
  });

  test("adds DOCX zoom and fullscreen without weakening its iframe sandbox", () => {
    expect(previewSource).toContain("<DocxFileDocumentPreview");
    expect(docxSource).toContain("<DocxAttachmentPreview");
    expect(docxSource).toContain("Math.round(zoom * 100)");
    expect(docxSource).toContain("createPortal(viewer, document.body)");
    expect(readFileSync(new URL("./attachments/DocxAttachmentPreview.tsx", import.meta.url), "utf8"))
      .toContain('sandbox=""');
  });
});
