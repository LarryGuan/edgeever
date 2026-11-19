import { useState } from "react";
import { useTranslation } from "react-i18next";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

import "yet-another-react-lightbox/styles.css";

import { AudioAttachmentPlayer } from "@/components/attachments/AudioAttachmentPlayer";
import { DocxAttachmentPreview } from "@/components/attachments/DocxAttachmentPreview";
import { VideoAttachmentPlayer } from "@/components/attachments/VideoAttachmentPlayer";
import { HtmlFilePreview } from "@/components/file-document/HtmlFilePreview";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { isDesktopResourceRuntime, toApiResourceUrl } from "@/lib/desktop-resources";
import { resolveFileDocumentPreviewer } from "@/lib/file-document-presentation";
import type { Resource } from "@edgeever/shared";

export const FileDocumentPreview = ({
  resource,
  readResource,
}: {
  resource: Resource;
  readResource: (resourceId: string) => Promise<Blob>;
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
        />
      </div>
    );
  }

  if (previewer.kind === "image") {
    return (
      <>
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
      </>
    );
  }

  if (previewer.kind === "audio") {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-card p-4 shadow-sm">
          <AudioAttachmentPlayer
            src={url}
            label={t("audioPlayer.label", { filename })}
            unavailableMessage={t("audioPlayer.unavailable")}
          />
        </div>
      </div>
    );
  }

  if (previewer.kind === "video") {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-slate-950 [&>video]:max-h-full [&>video]:w-full">
          <VideoAttachmentPlayer
            src={url}
            label={t("videoPlayer.label", { filename })}
            unavailableMessage={t("videoPlayer.unavailable")}
          />
      </div>
    );
  }

  if (previewer.kind === "docx") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-100 [&>iframe]:!h-full [&>iframe]:min-h-0 [&>iframe]:flex-1">
        <div className="flex shrink-0 items-center justify-end gap-3 border-b border-slate-200 bg-card px-4 py-2">
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            {t("fileNote.previewBeta")}
          </span>
        </div>
        <DocxAttachmentPreview url={url} filename={filename} />
      </div>
    );
  }

  if (previewer.kind === "html") {
    return (
      <div className="h-full min-h-0 w-full overflow-hidden bg-white">
        <HtmlFilePreview resource={resource} readResource={readResource} />
      </div>
    );
  }

  return null;
};
