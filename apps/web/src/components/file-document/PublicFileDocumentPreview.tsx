import { Download } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { IconTooltip } from "@/components/editor/EditorPaneChrome";
import { FileDocumentPreview, type FileDocumentPreviewResource } from "@/components/file-document/FileDocumentPreview";
import { Button } from "@/components/ui/button";
import type { PublicFileDocument } from "@edgeever/shared";

export const PublicFileDocumentPreview = ({
  document,
  updatedAt,
}: {
  document: PublicFileDocument;
  updatedAt: string;
}) => {
  const { t } = useTranslation();
  const resource = useMemo<FileDocumentPreviewResource>(() => ({
    ...document.resource,
    sha256: null,
    updatedAt,
  }), [document.resource, updatedAt]);
  const readResource = useCallback(async () => {
    const response = await fetch(resource.url, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`Public resource request failed: ${response.status}`);
    return response.blob();
  }, [resource.url]);

  return (
    <div className="h-[70dvh] min-h-[24rem] w-full overflow-hidden sm:h-[76dvh]">
      <FileDocumentPreview
        resource={resource}
        readResource={readResource}
        toolbar={(
          <IconTooltip label={t("fileNote.downloadOriginal")}>
            <Button asChild variant="ghost" size="icon" className="h-8 w-8">
              <a href={resource.url} download={resource.filename || undefined} aria-label={t("fileNote.downloadOriginal")}>
                <Download className="h-4 w-4" />
              </a>
            </Button>
          </IconTooltip>
        )}
      />
    </div>
  );
};
