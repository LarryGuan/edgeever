import { fileDocumentResourceId, parseFileDocument, type PublicFileDocument } from "@edgeever/shared";

export type PublicFileResourceRow = {
  id: string;
  filename: string | null;
  mime_type: string | null;
  byte_size: number;
};

export const publicFileDocumentIdentity = (contentMarkdown: string) => {
  const source = parseFileDocument(contentMarkdown);
  const resourceId = fileDocumentResourceId(source);
  return source && resourceId ? { formatKey: source.formatKey, resourceId } : null;
};

export const mapPublicFileDocument = (
  formatKey: string,
  resourceBasePath: string,
  resource: PublicFileResourceRow,
): PublicFileDocument => ({
  formatKey,
  resource: {
    id: resource.id,
    filename: resource.filename,
    mimeType: resource.mime_type,
    byteSize: resource.byte_size,
    url: `${resourceBasePath}/${encodeURIComponent(resource.id)}/blob`,
  },
});
