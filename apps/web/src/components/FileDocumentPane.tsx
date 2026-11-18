import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Download, Loader2, Pencil, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AttachmentFileIcon } from "@/components/attachments/AttachmentFileIcon";
import { FileDocumentPreview } from "@/components/file-document/FileDocumentPreview";
import { FileDocumentRenameDialog } from "@/components/file-document/FileDocumentRenameDialog";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format-bytes";
import { resolveFileDocumentPreviewer } from "@/lib/file-document-presentation";
import type { EdgeEverRepository } from "@/lib/repository";
import { toDesktopResourceDownloadUrl } from "@/lib/desktop-resources";
import type { MemoDetail, Resource } from "@edgeever/shared";

export const FileDocumentPane = ({
  memo,
  repository,
  readOnly = false,
  onBackToList,
}: {
  memo: MemoDetail;
  repository: EdgeEverRepository;
  readOnly?: boolean;
  onBackToList: () => void;
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const resourcesQuery = useQuery({
    queryKey: ["memo-resources", memo.id],
    queryFn: () => repository.listMemoResources(memo.id),
  });
  const resources = resourcesQuery.data?.resources ?? [];
  const expectedId = memo.document?.primaryResourceId;
  const primary = resources.find((resource) => resource.role === "primary")
    ?? resources.find((resource) => resource.id === expectedId)
    ?? null;
  const previewer = primary ? resolveFileDocumentPreviewer(primary) : null;

  const replaceFile = async (file: File) => {
    if (!primary?.sha256 || replacing) return;
    setReplacing(true);
    setReplaceError(false);
    try {
      const result = await repository.updateResource(primary.id, file, primary.sha256);
      queryClient.setQueryData<{ resources: Resource[] }>(["memo-resources", memo.id], (current) => ({
        resources: (current?.resources ?? resources).map((resource) => (
          resource.id === result.resource.id ? result.resource : resource
        )),
      }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["resources"] }),
      ]);
    } catch {
      setReplaceError(true);
    } finally {
      setReplacing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const renameFile = async (filename: string) => {
    if (!primary || renaming) return;
    setRenaming(true);
    setRenameError(null);
    try {
      const result = await repository.renameResource(primary.id, filename);
      queryClient.setQueryData<{ resources: Resource[] }>(["memo-resources", memo.id], (current) => ({
        resources: (current?.resources ?? resources).map((resource) => (
          resource.id === result.resource.id ? result.resource : resource
        )),
      }));
      await queryClient.invalidateQueries({ queryKey: ["resources"] });
      setRenameOpen(false);
    } catch {
      setRenameError(t("fileNote.renameFailed"));
    } finally {
      setRenaming(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex min-h-14 items-center gap-2 border-b border-slate-200 px-3 sm:px-5">
        <Button type="button" variant="ghost" size="icon" onClick={onBackToList} aria-label={t("common.back")}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-950">{memo.title || t("fileNote.title")}</h1>
          <p className="text-xs text-slate-500">{t("fileNote.title")}</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 justify-center overflow-auto p-5 sm:p-8">
        {resourcesQuery.isLoading ? (
          <div className="flex items-center self-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("fileNote.loading")}
          </div>
        ) : primary ? (
          <div className="flex w-full max-w-6xl flex-col items-center gap-4">
            <div className="w-full rounded-xl border border-slate-200 bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    <AttachmentFileIcon mimeType={primary.mimeType} filename={primary.filename} className="h-8 w-8" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-slate-950">{primary.filename || memo.title || primary.id}</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatBytes(primary.byteSize)} · {primary.mimeType || t("fileNote.unknownType")}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="solid" size="sm">
                    <a href={toDesktopResourceDownloadUrl(primary.url, primary.filename || memo.title || "file")} download={primary.filename || undefined}>
                      <Download className="h-4 w-4" />
                      {t("fileNote.download")}
                    </a>
                  </Button>
                  {!readOnly ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => {
                      setRenameError(null);
                      setRenameOpen(true);
                    }}>
                      <Pencil className="h-4 w-4" />
                      {t("editor.resourceActions.rename")}
                    </Button>
                  ) : null}
                  {!readOnly ? (
                    <>
                      <input
                        ref={inputRef}
                        type="file"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          if (file) void replaceFile(file);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!primary.sha256 || replacing}
                        onClick={() => inputRef.current?.click()}
                      >
                        {replacing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {replacing ? t("fileNote.replacing") : t("fileNote.replace")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              {previewer?.kind === "download" ? (
                <p className="mt-3 border-t border-slate-100 pt-3 text-sm leading-6 text-slate-600">{t("fileNote.readOnlyDescription")}</p>
              ) : null}
              {replaceError ? <p className="mt-3 text-sm text-rose-600">{t("fileNote.replaceFailed")}</p> : null}
            </div>
            <FileDocumentPreview resource={primary} />
          </div>
        ) : (
          <div className="max-w-md self-center rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            {t("fileNote.unavailable")}
          </div>
        )}
      </div>
      {primary ? (
        <FileDocumentRenameDialog
          open={renameOpen}
          filename={primary.filename || primary.id}
          pending={renaming}
          error={renameError}
          onOpenChange={(open) => {
            setRenameOpen(open);
            if (!open) setRenameError(null);
          }}
          onRename={renameFile}
        />
      ) : null}
    </section>
  );
};

export default FileDocumentPane;
