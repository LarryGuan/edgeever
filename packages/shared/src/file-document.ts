export type FileDocumentSource = {
  formatKey: string;
  resourceUrl: string;
};

const FILE_DOCUMENT_MARKER = /<!--\s*edgeever-file-v1:([a-z0-9][a-z0-9._-]{0,79})\s+(\S+)\s*-->/i;
const FORMAT_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export const inferFileDocumentFormatKey = (filename: string, mimeType?: string | null) => {
  const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const mime = mimeType?.toLowerCase() ?? "";
  if (extension === "d2") return "d2";
  if (extension === "pdf" || mime === "application/pdf") return "pdf";
  if (extension === "docx" || mime.includes("wordprocessingml")) return "word";
  if (extension === "xlsx" || mime.includes("spreadsheetml")) return "spreadsheet";
  if (extension === "pptx" || mime.includes("presentationml")) return "presentation";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return "generic-file";
};

export const serializeFileDocumentMarker = ({ formatKey, resourceUrl }: FileDocumentSource) => {
  const normalizedFormat = FORMAT_KEY_PATTERN.test(formatKey) ? formatKey : "generic-file";
  if (!resourceUrl || /\s|-->/.test(resourceUrl)) throw new Error("Invalid file document resource URL");
  return `<!-- edgeever-file-v1:${normalizedFormat} ${resourceUrl} -->`;
};

export const parseFileDocument = (markdown: string | null | undefined): FileDocumentSource | null => {
  const match = markdown?.match(FILE_DOCUMENT_MARKER);
  return match ? { formatKey: match[1].toLowerCase(), resourceUrl: match[2] } : null;
};

export const hasFileDocumentMarker = (markdown: string | null | undefined) => Boolean(parseFileDocument(markdown));

export const fileDocumentResourceId = (source: FileDocumentSource | null | undefined): string | null => {
  if (!source) return null;
  const staged = source.resourceUrl.match(/^edgeever-staged:\/\/([^/?#]+)/i)?.[1];
  if (staged) return `staged_${decodeURIComponent(staged)}`;
  const desktop = source.resourceUrl.match(/^edgeever-resource:\/\/resource\/([^/?#]+)/i)?.[1];
  if (desktop) return decodeURIComponent(desktop);
  try {
    const url = new URL(source.resourceUrl, "http://edgeever.local");
    const match = url.pathname.match(/\/api\/v1\/resources\/([^/]+)\/blob$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
};
