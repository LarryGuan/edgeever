import { isPdfAttachment, resolveAttachmentKind, type Resource } from "@edgeever/shared";

export type FileDocumentPreviewKind = "pdf" | "image" | "audio" | "video" | "docx" | "html" | "download";

type Previewer = {
  kind: Exclude<FileDocumentPreviewKind, "download">;
  matches: (resource: Pick<Resource, "filename" | "mimeType">) => boolean;
};

export const FILE_DOCUMENT_PREVIEWERS: readonly Previewer[] = [
  {
    kind: "pdf",
    matches: (resource) => isPdfAttachment(resource.mimeType, resource.filename),
  },
  {
    kind: "image",
    matches: (resource) => resolveAttachmentKind(resource.mimeType, resource.filename) === "image",
  },
  {
    kind: "audio",
    matches: (resource) => resolveAttachmentKind(resource.mimeType, resource.filename) === "audio",
  },
  {
    kind: "video",
    matches: (resource) => resolveAttachmentKind(resource.mimeType, resource.filename) === "video",
  },
  {
    kind: "docx",
    matches: (resource) => resource.filename?.trim().toLowerCase().endsWith(".docx") === true,
  },
  {
    kind: "html",
    matches: (resource) => {
      const filename = resource.filename?.trim().toLowerCase() ?? "";
      return resource.mimeType?.toLowerCase() === "text/html"
        || filename.endsWith(".html")
        || filename.endsWith(".htm");
    },
  },
] as const;

export const resolveFileDocumentPreviewer = (resource: Pick<Resource, "filename" | "mimeType">) =>
  FILE_DOCUMENT_PREVIEWERS.find((previewer) => previewer.matches(resource))
  ?? { kind: "download" as const };

export type FileDocumentFilenameParts = {
  stem: string;
  extension: string;
};

export const splitFileDocumentFilename = (filename: string): FileDocumentFilenameParts => {
  const normalized = filename.trim();
  const dot = normalized.lastIndexOf(".");
  if (dot <= 0 || dot === normalized.length - 1) return { stem: normalized, extension: "" };
  return { stem: normalized.slice(0, dot), extension: normalized.slice(dot) };
};

export const buildFileDocumentFilename = (originalFilename: string, requestedStem: string) => {
  const { extension } = splitFileDocumentFilename(originalFilename);
  const maxStemLength = Math.max(1, 160 - extension.length);
  const stem = requestedStem
    .trim()
    .replace(/[\\/]/g, "-")
    // oxlint-disable-next-line no-control-regex -- mirrors server filename normalization.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, maxStemLength)
    .trim();
  return stem ? `${stem}${extension}` : "";
};
