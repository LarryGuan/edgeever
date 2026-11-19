import { Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { DocxAttachmentPreview } from "@/components/attachments/DocxAttachmentPreview";
import { MemoEditorToolbarRow } from "@/components/MemoEditorToolbarChrome";
import { ButtonTooltip } from "@/components/ui/button-tooltip";
import { cn } from "@/lib/utils";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

export const DocxFileDocumentPreview = ({
  url,
  filename,
  toolbar,
}: {
  url: string;
  filename: string;
  toolbar: ReactNode;
}) => {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [fullscreen]);

  const viewer = (
    <div className={cn(
      "flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-100",
      fullscreen && "fixed inset-0 z-[120] bg-slate-950/95 p-3 sm:p-5",
    )} role={fullscreen ? "dialog" : undefined} aria-modal={fullscreen || undefined}>
      <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-100", fullscreen && "mx-auto w-full max-w-6xl rounded-xl bg-card shadow-2xl")}>
        <MemoEditorToolbarRow className="shrink-0 border-b border-slate-200 bg-card" role="toolbar" aria-label={t("fileNote.toolbar")}>
          {!fullscreen ? toolbar : null}
          {!fullscreen && toolbar ? <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-slate-200" /> : null}
          <ButtonTooltip title={t("pdfViewer.zoomOut")}>
            <button type="button" className="pdf-viewer-action" aria-label={t("pdfViewer.zoomOut")} disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}>
              <ZoomOut aria-hidden="true" />
            </button>
          </ButtonTooltip>
          <span className="min-w-12 text-center text-xs tabular-nums text-slate-500" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <ButtonTooltip title={t("pdfViewer.zoomIn")}>
            <button type="button" className="pdf-viewer-action" aria-label={t("pdfViewer.zoomIn")} disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}>
              <ZoomIn aria-hidden="true" />
            </button>
          </ButtonTooltip>
          <ButtonTooltip title={t("pdfViewer.fitWidth")}>
            <button type="button" className={cn("pdf-viewer-action", zoom === 1 && "is-active")} aria-label={t("pdfViewer.fitWidth")} aria-pressed={zoom === 1} onClick={() => setZoom(1)}>
              <RotateCcw aria-hidden="true" />
            </button>
          </ButtonTooltip>
          <ButtonTooltip title={t(fullscreen ? "pdfViewer.exitFullscreen" : "pdfViewer.fullscreen")}>
            <button type="button" className="pdf-viewer-action" aria-label={t(fullscreen ? "pdfViewer.exitFullscreen" : "pdfViewer.fullscreen")} onClick={() => setFullscreen((value) => !value)}>
              {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </button>
          </ButtonTooltip>
        </MemoEditorToolbarRow>
        <div className="min-h-0 flex-1 overflow-hidden">
          <DocxAttachmentPreview url={url} filename={filename} zoom={zoom} fill />
        </div>
      </div>
    </div>
  );

  return fullscreen ? createPortal(viewer, document.body) : viewer;
};
