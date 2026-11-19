import DOMPurify from "dompurify";

export const HTML_FILE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

export type HtmlFilePreviewLoadResult =
  | { ok: true; html: string }
  | { ok: false; reason: "too-large" | "encoding" };

const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "img-src data:",
  "media-src data:",
  "font-src data:",
  "style-src 'unsafe-inline'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export const decodeHtmlFilePreview = async (blob: Blob): Promise<HtmlFilePreviewLoadResult> => {
  if (blob.size > HTML_FILE_PREVIEW_MAX_BYTES) return { ok: false, reason: "too-large" };
  try {
    return {
      ok: true,
      html: new TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer()),
    };
  } catch {
    return { ok: false, reason: "encoding" };
  }
};

export const sanitizeHtmlFilePreview = (html: string) => {
  const sanitized = String(DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      "script",
      "iframe",
      "frame",
      "frameset",
      "object",
      "embed",
      "form",
      "base",
      "link",
      "meta",
    ],
    FORBID_ATTR: ["srcdoc", "action", "formaction", "ping"],
    ALLOWED_URI_REGEXP: /^(?:#|data:(?:image|audio|video|font)\/)/i,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  }));
  const policy = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`;
  if (/<head(?:\s[^>]*)?>/i.test(sanitized)) {
    return sanitized.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${policy}`);
  }
  return `<!doctype html><html><head>${policy}</head><body>${sanitized}</body></html>`;
};
