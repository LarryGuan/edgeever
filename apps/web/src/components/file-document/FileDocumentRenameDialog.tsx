import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { buildFileDocumentFilename, splitFileDocumentFilename } from "@/lib/file-document-presentation";

export const FileDocumentRenameDialog = ({
  open,
  filename,
  pending,
  error,
  onOpenChange,
  onRename,
}: {
  open: boolean;
  filename: string;
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onRename: (filename: string) => Promise<void> | void;
}) => {
  const { t } = useTranslation();
  const parts = splitFileDocumentFilename(filename);
  const [stem, setStem] = useState(parts.stem);
  const nextFilename = buildFileDocumentFilename(filename, stem);

  useEffect(() => {
    if (open) setStem(splitFileDocumentFilename(filename).stem);
  }, [filename, open]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!pending) onOpenChange(nextOpen); }}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (nextFilename && nextFilename !== filename) void onRename(nextFilename);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("fileNote.renameTitle")}</DialogTitle>
            <DialogDescription>{t("fileNote.renameDescription")}</DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            {t("fileNote.filenameLabel")}
            <span className="flex min-w-0 items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              <Input
                autoFocus
                value={stem}
                maxLength={Math.max(1, 160 - parts.extension.length)}
                disabled={pending}
                onChange={(event) => setStem(event.target.value)}
                className="min-w-0 flex-1 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {parts.extension ? <span className="shrink-0 pr-3 text-sm text-slate-500">{parts.extension}</span> : null}
            </span>
          </label>
          {error ? <p className="text-sm text-rose-600" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="solid" disabled={pending || !nextFilename || nextFilename === filename}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
