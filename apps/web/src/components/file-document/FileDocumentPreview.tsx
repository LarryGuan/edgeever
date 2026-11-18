import { useState } from "react";
import { useTranslation } from "react-i18next";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

import "yet-another-react-lightbox/styles.css";

import { AudioAttachmentPlayer } from "@/components/attachments/AudioAttachmentPlayer";
import { DocxAttachmentPreview } from "@/components/attachments/DocxAttachmentPreview";
import { VideoAttachmentPlayer } from "@/components/attachments/VideoAttachmentPlayer";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { isDesktopResourceRuntime, toApiResourceUrl } from "@/lib/desktop-resources";
import { resolveFileDocumentPreviewer } from "@/lib/file-document-presentation";
import type { Resource } from "@edgeever/shared";

export const FileDocumentPreview = ({ resource }: { resource: Resource }) => {
  const { t } = useTranslation();
  const [imageOpen, setImageOpen] = useState(false);
  const previewer = resolveFileDocumentPreviewer(resource);
  const filename = resource.filename || resource.id;
  const url = isDesktopResourceRuntime() ? resource.url : toApiResourceUrl(resource.url);

  if (previewer.kind === "pdf") {
    return (
      <div className="w-full max-w-6xl">
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
          className="flex max-h-[72vh] w-full max-w-6xl items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
          aria-label={t("assets.previewImage")}
          onClick={() => setImageOpen(true)}
        >
          <img src={url} alt={filename} className="max-h-[68vh] max-w-full object-contain" />
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
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-card p-4 shadow-sm">
        <AudioAttachmentPlayer
          src={url}
          label={t("audioPlayer.label", { filename })}
          unavailableMessage={t("audioPlayer.unavailable")}
        />
      </div>
    );
  }

  if (previewer.kind === "video") {
    return (
      <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-slate-200 bg-card shadow-sm">
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
      <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-slate-200 bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
          <span className="min-w-0 truncate text-sm font-semibold text-slate-800">{filename}</span>
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            {t("fileNote.previewBeta")}
          </span>
        </div>
        <DocxAttachmentPreview url={url} filename={filename} />
      </div>
    );
  }

  return null;
};
