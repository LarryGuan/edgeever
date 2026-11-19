import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodeHtmlFilePreview, HTML_FILE_PREVIEW_MAX_BYTES } from "./html-file-preview.ts";

const previewSource = readFileSync(new URL("../components/file-document/HtmlFilePreview.tsx", import.meta.url), "utf8");
const policySource = readFileSync(new URL("./html-file-preview.ts", import.meta.url), "utf8");

describe("HTML file preview", () => {
  test("accepts UTF-8 within the preview limit", async () => {
    await expect(decodeHtmlFilePreview(new Blob(["<!doctype html><p>你好</p>"]))).resolves.toEqual({
      ok: true,
      html: "<!doctype html><p>你好</p>",
    });
  });

  test("rejects oversized or invalid UTF-8 input", async () => {
    await expect(decodeHtmlFilePreview(new Blob([new Uint8Array(HTML_FILE_PREVIEW_MAX_BYTES + 1)]))).resolves.toEqual({
      ok: false,
      reason: "too-large",
    });
    await expect(decodeHtmlFilePreview(new Blob([new Uint8Array([0xc3, 0x28])]))).resolves.toEqual({
      ok: false,
      reason: "encoding",
    });
  });

  test("uses an opaque iframe sandbox and a deny-by-default content policy", () => {
    expect(previewSource).toContain('sandbox=""');
    expect(previewSource).not.toContain("allow-scripts");
    expect(policySource).toContain("default-src 'none'");
    expect(policySource).toContain("connect-src 'none'");
    expect(policySource).toContain('"script"');
    expect(policySource).toContain('"form"');
  });
});
