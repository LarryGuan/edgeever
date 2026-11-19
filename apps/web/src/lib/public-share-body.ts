import {
  hasDiagramDocumentMarker,
  hasInfographicDocumentMarker,
  hasTableDocumentMarker,
  markdownToDoc,
  parseDiagramDocument,
  parseInfographicDocument,
  parseTableDocument,
  resolveMemoContentDoc,
  rewriteMemoResourcesForShare,
  stripDiagramDocumentMarker,
  stripInfographicDocumentMarker,
  stripTableDocumentMarker,
  tableFallbackMarkdown,
  type DiagramDocument,
  type InfographicDocument,
  type PublicFileDocument,
  type PublicMemoShare,
  type TiptapDoc,
  type ShareBodyAccess,
} from "@edgeever/shared";

export type PublicShareBody =
  | { type: "file"; document: PublicFileDocument }
  | { type: "diagram"; diagram: DiagramDocument }
  | { type: "infographic"; infographic: InfographicDocument }
  | { type: "rich-text"; content: TiptapDoc };

/** Visual diagram notes share through IR → X6. Ordinary notes, including embedded Mermaid fences, stay on TipTap. */
export const resolvePublicShareBody = (share: PublicMemoShare, token: string, access?: ShareBodyAccess): PublicShareBody => {
  if (share.fileDocument) return { type: "file", document: share.fileDocument };
  const diagram = parseDiagramDocument(share.contentMarkdown);
  if (diagram) return { type: "diagram", diagram };
  const infographic = parseInfographicDocument(share.contentMarkdown);
  if (infographic) return { type: "infographic", infographic };
  const table = parseTableDocument(share.contentMarkdown);
  if (table) {
    return { type: "rich-text", content: rewriteMemoResourcesForShare(markdownToDoc(tableFallbackMarkdown(table)), token, share.memoShareTokens, access) };
  }
  const richText = hasInfographicDocumentMarker(share.contentMarkdown)
    ? markdownToDoc(stripInfographicDocumentMarker(share.contentMarkdown))
    : hasDiagramDocumentMarker(share.contentMarkdown) || hasTableDocumentMarker(share.contentMarkdown)
    ? markdownToDoc(hasTableDocumentMarker(share.contentMarkdown) ? stripTableDocumentMarker(share.contentMarkdown) : stripDiagramDocumentMarker(share.contentMarkdown))
    : resolveMemoContentDoc(share.contentJson, share.contentMarkdown);
  return {
    type: "rich-text",
    content: rewriteMemoResourcesForShare(richText, token, share.memoShareTokens, access),
  };
};
