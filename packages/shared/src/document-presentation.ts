import { parseDiagramDocument } from "./diagram";
import { fileDocumentResourceId, parseFileDocument } from "./file-document";
import { parseInfographicDocument } from "./infographic";
import { parsePosterDocument } from "./poster";
import { parseTableDocument } from "./table";

export type DocumentCapabilities = {
  download: boolean;
  preview: boolean;
  edit: boolean;
  searchContent: boolean;
  export: boolean;
};

export type DocumentDescriptor = {
  storageMode: "inline" | "resource";
  formatKey: string;
  primaryResourceId: string | null;
  capabilities: DocumentCapabilities;
};

const inlineCapabilities = (): DocumentCapabilities => ({
  download: false,
  preview: true,
  edit: true,
  searchContent: true,
  export: true,
});

export const resolveDocumentDescriptor = (markdown: string | null | undefined): DocumentDescriptor => {
  const file = parseFileDocument(markdown);
  if (file) {
    return {
      storageMode: "resource",
      formatKey: file.formatKey,
      primaryResourceId: fileDocumentResourceId(file),
      capabilities: { download: true, preview: false, edit: false, searchContent: false, export: false },
    };
  }
  const diagram = parseDiagramDocument(markdown);
  if (diagram) return { storageMode: "inline", formatKey: `edgeever.${diagram.kind}`, primaryResourceId: null, capabilities: inlineCapabilities() };
  if (parseTableDocument(markdown)) return { storageMode: "inline", formatKey: "edgeever.table", primaryResourceId: null, capabilities: inlineCapabilities() };
  if (parsePosterDocument(markdown)) return { storageMode: "inline", formatKey: "edgeever.poster", primaryResourceId: null, capabilities: inlineCapabilities() };
  if (parseInfographicDocument(markdown)) return { storageMode: "inline", formatKey: "edgeever.infographic", primaryResourceId: null, capabilities: inlineCapabilities() };
  return { storageMode: "inline", formatKey: "markdown", primaryResourceId: null, capabilities: inlineCapabilities() };
};
