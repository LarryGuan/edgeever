import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format-bytes";
import type { Resource } from "@edgeever/shared";

export const FileDocumentInfoDialog = ({
  open,
  resource,
  onOpenChange,
}: {
  open: boolean;
  resource: Resource;
  onOpenChange: (open: boolean) => void;
}) => {
  const { t, i18n } = useTranslation();
  const updatedAt = useMemo(() => {
    const date = new Date(resource.updatedAt);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
      : resource.updatedAt;
  }, [i18n.language, i18n.resolvedLanguage, resource.updatedAt]);
  const rows = [
    [t("fileNote.sourceFilename"), resource.filename || resource.id],
    [t("fileNote.mimeType"), resource.mimeType || t("fileNote.unknownType")],
    [t("fileNote.fileSize"), formatBytes(resource.byteSize)],
    [t("fileNote.updatedAt"), updatedAt],
    [t("fileNote.sha256"), resource.sha256 || t("fileNote.unavailableValue")],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("fileNote.fileInfo")}</DialogTitle>
          <DialogDescription>{t("fileNote.fileInfoDescription")}</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60 px-4">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-xs font-medium text-slate-500">{label}</dt>
              <dd className="min-w-0 break-all text-sm text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
};
