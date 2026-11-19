import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronLeft, Download, Info, Loader2, Share2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ShareMemoDialog } from "@/components/dialogs/ShareMemoDialog";
import { IconTooltip } from "@/components/editor/EditorPaneChrome";
import { createLocalEditSession } from "@/components/editor/editor-pane-helpers";
import { FileDocumentInfoDialog } from "@/components/file-document/FileDocumentInfoDialog";
import { FileDocumentPreview } from "@/components/file-document/FileDocumentPreview";
import { MemoEditorMetadataRow } from "@/components/MemoEditorMetadataRow";
import { MEMO_EDITOR_METADATA_ROW_CLASS_NAME, MEMO_EDITOR_TOP_ROW_CLASS_NAME } from "@/components/MemoEditorChromeDensity";
import { MemoEditorTopRowLeading } from "@/components/MemoEditorTopRowLeading";
import { MemoTitleInput } from "@/components/MemoTitleInput";
import { Button } from "@/components/ui/button";
import { getNotebookMoveOptions } from "@/lib/app-helpers";
import { toDesktopResourceDownloadUrl } from "@/lib/desktop-resources";
import type { EdgeEverRepository } from "@/lib/repository";
import { parseTagsText } from "@/lib/utils";
import type { MemoDetail, Notebook, Resource } from "@edgeever/shared";

type MetadataFields = { title: string; tagsText: string };
type SavePhase = "idle" | "saving" | "saved" | "error";

const metadataFieldsFromMemo = (memo: MemoDetail): MetadataFields => ({
  title: memo.title ?? "",
  tagsText: memo.tags.join(", "),
});

const sameMetadataFields = (first: MetadataFields, second: MetadataFields) =>
  first.title === second.title && first.tagsText === second.tagsText;

export const FileDocumentPane = ({
  memo,
  notebooks,
  repository,
  readOnly = false,
  onBackToList,
  onSaved,
}: {
  memo: MemoDetail;
  notebooks: Notebook[];
  repository: EdgeEverRepository;
  readOnly?: boolean;
  onBackToList: () => void;
  onSaved: (memo: MemoDetail) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const memoRef = useRef(memo);
  const fieldsRef = useRef<MetadataFields>(metadataFieldsFromMemo(memo));
  const savedFieldsRef = useRef<MetadataFields>(metadataFieldsFromMemo(memo));
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const pendingSaveRef = useRef(false);
  const flushMetadataRef = useRef<() => Promise<boolean>>(async () => true);
  const [title, setTitle] = useState(memo.title ?? "");
  const [tagsText, setTagsText] = useState(memo.tags.join(", "));
  const [selectedNotebookId, setSelectedNotebookId] = useState(memo.notebookId);
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");
  const [mobileNotebookPickerOpen, setMobileNotebookPickerOpen] = useState(false);
  const [notebookUpdatePending, setNotebookUpdatePending] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [fileInfoOpen, setFileInfoOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState(false);
  const notebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const resourcesQuery = useQuery({
    queryKey: ["memo-resources", memo.id],
    queryFn: () => repository.listMemoResources(memo.id),
  });
  const resources = resourcesQuery.data?.resources ?? [];
  const expectedId = memo.document?.primaryResourceId;
  const primary = resources.find((resource) => resource.role === "primary")
    ?? resources.find((resource) => resource.id === expectedId)
    ?? null;

  useEffect(() => {
    const fields = metadataFieldsFromMemo(memo);
    memoRef.current = memo;
    fieldsRef.current = fields;
    savedFieldsRef.current = fields;
    savePromiseRef.current = null;
    pendingSaveRef.current = false;
    setTitle(fields.title);
    setTagsText(fields.tagsText);
    setSelectedNotebookId(memo.notebookId);
    setSavePhase("idle");
  }, [memo.id]);

  const flushMetadata = useCallback((): Promise<boolean> => {
    if (readOnly || sameMetadataFields(fieldsRef.current, savedFieldsRef.current)) return Promise.resolve(true);
    if (savePromiseRef.current) {
      pendingSaveRef.current = true;
      return savePromiseRef.current;
    }

    const fields = { ...fieldsRef.current };
    const source = memoRef.current;
    setSavePhase("saving");
    const promise = repository.updateMemo(source, {
      expectedRevision: source.revision,
      expectedContentHash: source.contentHash,
      editSessionId: createLocalEditSession(source).id,
      title: fields.title,
      contentJson: source.contentJson,
      contentMarkdown: source.contentMarkdown,
      tags: parseTagsText(fields.tagsText),
    }, { guardLocalSnapshot: true })
      .then(async ({ memo: savedMemo }) => {
        if (memoRef.current.id === source.id) {
          memoRef.current = savedMemo;
          savedFieldsRef.current = fields;
        }
        await onSaved(savedMemo);
        if (memoRef.current.id === source.id && sameMetadataFields(fieldsRef.current, fields)) setSavePhase("saved");
        return true;
      })
      .catch(() => {
        if (memoRef.current.id === source.id) setSavePhase("error");
        return false;
      })
      .finally(() => {
        if (savePromiseRef.current === promise) {
          savePromiseRef.current = null;
          if (pendingSaveRef.current) {
            pendingSaveRef.current = false;
            window.setTimeout(() => void flushMetadataRef.current(), 0);
          }
        }
      });
    savePromiseRef.current = promise;
    return promise;
  }, [onSaved, readOnly, repository]);
  flushMetadataRef.current = flushMetadata;

  useEffect(() => {
    if (readOnly || sameMetadataFields(fieldsRef.current, savedFieldsRef.current)) return;
    const timer = window.setTimeout(() => void flushMetadata(), 600);
    return () => window.clearTimeout(timer);
  }, [flushMetadata, readOnly, tagsText, title]);

  const updateFields = (next: MetadataFields) => {
    fieldsRef.current = next;
    setTitle(next.title);
    setTagsText(next.tagsText);
    setSavePhase("idle");
  };

  const flushAllMetadata = async () => {
    const first = await flushMetadata();
    if (!first) return false;
    return sameMetadataFields(fieldsRef.current, savedFieldsRef.current) ? true : flushMetadata();
  };

  const handleBack = async () => {
    if (await flushAllMetadata()) onBackToList();
  };

  const handleNotebookChange = async (notebookId: string) => {
    if (notebookId === selectedNotebookId || notebookUpdatePending) return;
    setNotebookUpdatePending(true);
    try {
      if (!(await flushAllMetadata())) return;
      await repository.moveMemos({ memoIds: [memo.id], notebookId });
      const movedMemo = (await repository.getMemo(memo.id)).memo;
      memoRef.current = movedMemo;
      setSelectedNotebookId(notebookId);
      setMobileNotebookPickerOpen(false);
      await onSaved(movedMemo);
    } catch {
      setSavePhase("error");
    } finally {
      setNotebookUpdatePending(false);
    }
  };

  const replaceFile = async (file: File) => {
    if (!primary?.sha256 || replacing) return;
    setReplacing(true);
    setReplaceError(false);
    try {
      const result = await repository.updateResource(primary.id, file, primary.sha256);
      queryClient.setQueryData<{ resources: Resource[] }>(["memo-resources", memo.id], (current) => ({
        resources: (current?.resources ?? resources).map((resource) => resource.id === result.resource.id ? result.resource : resource),
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

  const saveLabel = savePhase === "saving"
    ? t("editor.saveState.saving")
    : savePhase === "error"
      ? t("editor.saveState.error")
      : savePhase === "idle" && !sameMetadataFields(fieldsRef.current, savedFieldsRef.current)
        ? t("editor.saveState.unsaved")
        : t("editor.saveState.saved");

  return (
    <section className="flex h-full min-h-0 flex-col bg-card">
      <header className="shrink-0 border-b border-[var(--workspace-divider)] bg-card">
        <div className={`${MEMO_EDITOR_TOP_ROW_CLASS_NAME} px-4`}>
          <MemoEditorTopRowLeading
            mobileBackButton={(
              <IconTooltip label={t("editor.backToList")}>
                <Button type="button" variant="ghost" size="icon" disabled={savePhase === "saving"} onClick={() => void handleBack()} aria-label={t("editor.backToList")}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </IconTooltip>
            )}
            titleInput={(
              <MemoTitleInput
                className="w-full min-w-0 px-2"
                value={title}
                readOnly={readOnly}
                onValueChange={(nextTitle) => updateFields({ title: nextTitle, tagsText: fieldsRef.current.tagsText })}
                placeholder={t("common.untitledMemo")}
              />
            )}
          />
          <MemoEditorMetadataRow
            rowClassName={MEMO_EDITOR_METADATA_ROW_CLASS_NAME}
            contentMarkdown={memoRef.current.contentMarkdown}
            disabled={readOnly}
            mobileNotebookPickerOpen={mobileNotebookPickerOpen}
            notebookOptions={notebookOptions}
            notebookUpdatePending={notebookUpdatePending || savePhase === "saving"}
            repository={repository}
            selectedNotebookId={selectedNotebookId}
            tagsText={tagsText}
            title={title}
            onMobileNotebookPickerOpenChange={setMobileNotebookPickerOpen}
            onNotebookChange={(notebookId) => void handleNotebookChange(notebookId)}
            onTagsChange={(nextTagsText) => updateFields({ title: fieldsRef.current.title, tagsText: nextTagsText })}
            trailingActions={(
              <>
                <span className={`hidden items-center gap-1 rounded-md px-2 py-1 text-xs sm:flex ${savePhase === "error" ? "bg-rose-50 text-rose-700" : "text-slate-400"}`}>
                  {savePhase === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : savePhase === "error" ? <AlertCircle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                  {saveLabel}
                </span>
                <IconTooltip label={t("sharing.title")}>
                  <Button type="button" className="h-8 w-8 text-slate-500" size="icon" variant="ghost" disabled={readOnly} aria-label={t("sharing.title")} onClick={() => setShareOpen(true)}>
                    <Share2 className="h-4 w-4" />
                  </Button>
                </IconTooltip>
              </>
            )}
          />
        </div>

        {replaceError ? <p className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-700">{t("fileNote.replaceFailed")}</p> : null}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {resourcesQuery.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("fileNote.loading")}
          </div>
        ) : primary ? (
          <FileDocumentPreview
            resource={primary}
            readResource={repository.readResource}
            toolbar={(
              <>
                <IconTooltip label={t("fileNote.fileInfo")}>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t("fileNote.fileInfo")} onClick={() => setFileInfoOpen(true)}>
                    <Info className="h-4 w-4" />
                  </Button>
                </IconTooltip>
                <IconTooltip label={t("fileNote.downloadOriginal")}>
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <a href={toDesktopResourceDownloadUrl(primary.url, primary.filename || memo.title || "file")} download={primary.filename || undefined} aria-label={t("fileNote.downloadOriginal")}>
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                </IconTooltip>
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
                    <IconTooltip label={replacing ? t("fileNote.replacing") : t("fileNote.replace")}>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={!primary.sha256 || replacing} aria-label={t("fileNote.replace")} onClick={() => inputRef.current?.click()}>
                        {replacing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      </Button>
                    </IconTooltip>
                  </>
                ) : null}
              </>
            )}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
            {t("fileNote.unavailable")}
          </div>
        )}
      </div>

      {primary ? <FileDocumentInfoDialog open={fileInfoOpen} resource={primary} onOpenChange={setFileInfoOpen} /> : null}
      <ShareMemoDialog memoId={memo.id} open={shareOpen} onOpenChange={setShareOpen} />
    </section>
  );
};

export default FileDocumentPane;
