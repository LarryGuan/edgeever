import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Download, Loader2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AttachmentFileIcon } from "@/components/attachments/AttachmentFileIcon";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format-bytes";
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
  const resourcesQuery = useQuery({
    queryKey: ["memo-resources", memo.id],
    queryFn: () => repository.listMemoResources(memo.id),
  });
  const resources = resourcesQuery.data?.resources ?? [];
  const expectedId = memo.document?.primaryResourceId;
  const primary = resources.find((resource) => resource.role === "primary")
    ?? resources.find((resource) => resource.id === expectedId)
    ?? null;

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
      await queryClient.invalidateQueries({ queryKey: ["memos"] });
    } catch {
      setReplaceError(true);
    } finally {
      setReplacing(false);
      if (inputRef.current) inputRef.current.value = "";
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

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5 sm:p-8">
        {resourcesQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("fileNote.loading")}
          </div>
        ) : primary ? (
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-slate-50/60 p-5 shadow-sm sm:p-7">
            <div className="flex items-start gap-4">
              <div className="rounded-xl border border-slate-200 bg-card p-3 shadow-sm">
                <AttachmentFileIcon mimeType={primary.mimeType} filename={primary.filename} className="h-10 w-10" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-base font-semibold text-slate-950">{primary.filename || memo.title || primary.id}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {formatBytes(primary.byteSize)} · {primary.mimeType || t("fileNote.unknownType")}
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-600">{t("fileNote.readOnlyDescription")}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild variant="solid">
                <a href={toDesktopResourceDownloadUrl(primary.url, primary.filename || memo.title || "file")} download={primary.filename || undefined}>
                  <Download className="h-4 w-4" />
                  {t("fileNote.download")}
                </a>
              </Button>
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
                    disabled={!primary.sha256 || replacing}
                    onClick={() => inputRef.current?.click()}
                  >
                    {replacing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {replacing ? t("fileNote.replacing") : t("fileNote.replace")}
                  </Button>
                </>
              ) : null}
            </div>
            {replaceError ? <p className="mt-3 text-sm text-rose-600">{t("fileNote.replaceFailed")}</p> : null}
          </div>
        ) : (
          <div className="max-w-md rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            {t("fileNote.unavailable")}
          </div>
        )}
      </div>
    </section>
  );
};

export default FileDocumentPane;
