import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

import "yet-another-react-lightbox/styles.css";

import { AudioAttachmentPlayer } from "@/components/attachments/AudioAttachmentPlayer";
import { VideoAttachmentPlayer } from "@/components/attachments/VideoAttachmentPlayer";
import { HtmlFilePreview } from "@/components/file-document/HtmlFilePreview";
import { DocxFileDocumentPreview } from "@/components/file-document/DocxFileDocumentPreview";
import { MemoEditorToolbarRow } from "@/components/MemoEditorToolbarChrome";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { isDesktopResourceRuntime, toApiResourceUrl } from "@/lib/desktop-resources";
import { resolveFileDocumentPreviewer } from "@/lib/file-document-presentation";
import type { Resource } from "@edgeever/shared";

export type FileDocumentPreviewResource = Pick<Resource, "id" | "filename" | "mimeType" | "byteSize" | "url" | "sha256" | "updatedAt">;

export const FileDocumentPreview = ({
  resource,
  readResource,
  toolbar,
}: {
  resource: FileDocumentPreviewResource;
  readResource: (resourceId: string) => Promise<Blob>;
  toolbar: ReactNode;
}) => {
  const { t } = useTranslation();
  const [imageOpen, setImageOpen] = useState(false);
  const previewer = resolveFileDocumentPreviewer(resource);
  const filename = resource.filename || resource.id;
  const url = isDesktopResourceRuntime() ? resource.url : toApiResourceUrl(resource.url);

  if (previewer.kind === "pdf") {
    return (
      <div className="h-full min-h-0 w-full overflow-hidden bg-slate-100 [&_.edgeever-pdf-viewer]:!h-full [&_.edgeever-pdf-viewer]:rounded-none [&_.edgeever-pdf-viewer]:border-0 [&_.edgeever-pdf-viewer]:shadow-none [&_.edgeever-pdf-viewer>span]:h-full [&_.edgeever-pdf-viewer>span]:min-h-0 [&_.edgeever-pdf-viewer>span>span:last-child]:!h-auto [&_.edgeever-pdf-viewer>span>span:last-child]:min-h-0 [&_.edgeever-pdf-viewer>span>span:last-child]:flex-1">
        <PdfViewer
          url={resource.url}
          label={filename}
          filename={resource.filename || undefined}
          byteSize={resource.byteSize}
          defaultExpanded
          mode="file-note"
          toolbarLeading={toolbar}
        />
      </div>
    );
  }

  if (previewer.kind === "image") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <MemoEditorToolbarRow className="shrink-0 border-b border-slate-200 bg-card" role="toolbar" aria-label={t("fileNote.toolbar")}>
          {toolbar}
        </MemoEditorToolbarRow>
        <div className="min-h-0 flex-1">
          <button
            type="button"
            className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-slate-50 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900/20"
            aria-label={t("assets.previewImage")}
            onClick={() => setImageOpen(true)}
          >
            <img src={url} alt={filename} className="max-h-full max-w-full object-contain" />
          </button>
          <Lightbox
            open={imageOpen}
            close={() => setImageOpen(false)}
            slides={[{ src: url, alt: filename }]}
            plugins={[Zoom]}
          />
        </div>
      </div>
    );
  }

  if (previewer.kind === "audio") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <MemoEditorToolbarRow className="shrink-0 border-b border-slate-200 bg-card" role="toolbar" aria-label={t("fileNote.toolbar")}>
          {toolbar}
        </MemoEditorToolbarRow>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 p-6">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-card p-4 shadow-sm">
            <AudioAttachmentPlayer
              src={url}
              label={t("audioPlayer.label", { filename })}
              unavailableMessage={t("audioPlayer.unavailable")}
            />
          </div>
        </div>
      </div>
    );
  }

  if (previewer.kind === "video") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <MemoEditorToolbarRow className="shrink-0 border-b border-slate-200 bg-card" role="toolbar" aria-label={t("fileNote.toolbar")}>
          {toolbar}
        </MemoEditorToolbarRow>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-slate-950 [&>video]:max-h-full [&>video]:w-full">
          <VideoAttachmentPlayer
            src={url}
            label={t("videoPlayer.label", { filename })}
            unavailableMessage={t("videoPlayer.unavailable")}
          />
        </div>
      </div>
    );
  }

  if (previewer.kind === "docx") {
    return <DocxFileDocumentPreview url={url} filename={filename} toolbar={toolbar} />;
  }

  if (previewer.kind === "html") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
        <MemoEditorToolbarRow className="shrink-0 border-b border-slate-200 bg-card" role="toolbar" aria-label={t("fileNote.toolbar")}>
          {toolbar}
        </MemoEditorToolbarRow>
        <div className="min-h-0 flex-1">
          <HtmlFilePreview resource={resource} readResource={readResource} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <MemoEditorToolbarRow className="shrink-0 border-b border-slate-200 bg-card" role="toolbar" aria-label={t("fileNote.toolbar")}>
        {toolbar}
      </MemoEditorToolbarRow>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm leading-6 text-slate-500">
        {t("fileNote.readOnlyDescription")}
      </div>
    </div>
  );
};
