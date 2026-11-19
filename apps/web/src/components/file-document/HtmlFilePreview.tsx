import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { decodeHtmlFilePreview, sanitizeHtmlFilePreview } from "@/lib/html-file-preview";
import type { FileDocumentPreviewResource } from "./FileDocumentPreview";

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; html: string }
  | { status: "too-large" | "encoding" | "error" };

export const HtmlFilePreview = ({
  resource,
  readResource,
}: {
  resource: FileDocumentPreviewResource;
  readResource: (resourceId: string) => Promise<Blob>;
}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void readResource(resource.id)
      .then(decodeHtmlFilePreview)
      .then((result) => {
        if (cancelled) return;
        setState(result.ok
          ? { status: "ready", html: sanitizeHtmlFilePreview(result.html) }
          : { status: result.reason });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [readResource, resource.id, resource.sha256, resource.updatedAt]);

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("fileNote.htmlPreviewLoading")}
      </div>
    );
  }

  if (state.status !== "ready") {
    const key = state.status === "too-large"
      ? "fileNote.htmlPreviewTooLarge"
      : state.status === "encoding"
        ? "fileNote.htmlPreviewEncoding"
        : "fileNote.htmlPreviewFailed";
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm leading-6 text-slate-500">
        {t(key)}
      </div>
    );
  }

  return (
    <iframe
      className="h-full w-full border-0 bg-white"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={state.html}
      title={t("fileNote.htmlPreviewTitle", { filename: resource.filename || resource.id })}
    />
  );
};
