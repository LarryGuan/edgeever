import { AlertCircle, CheckCircle2, FileUp, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FileUploadTaskStatus = "preparing" | "uploading" | "completed" | "failed" | "cancelled";

export type FileUploadTask = {
  id: string;
  filename: string;
  byteSize: number;
  uploadedBytes: number;
  status: FileUploadTaskStatus;
  memoId?: string;
};
const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const statusKey = (status: FileUploadTaskStatus) => {
  if (status === "preparing") return "memoList.uploadTaskPreparing";
  if (status === "uploading") return "memoList.uploadTaskUploading";
  if (status === "completed") return "memoList.uploadTaskCompleted";
  if (status === "cancelled") return "memoList.uploadTaskCancelled";
  return "memoList.uploadTaskFailed";
};

export const FileUploadTaskDock = ({
  tasks,
  onCancel,
  onDismiss,
  onOpen,
}: {
  tasks: FileUploadTask[];
  onCancel: (taskId: string) => void;
  onDismiss: (taskId: string) => void;
  onOpen: (memoId: string) => void;
}) => {
  const { t } = useTranslation();
  if (tasks.length === 0) return null;

  return (
    <section
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-50 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-slate-200 bg-card shadow-2xl lg:bottom-4 lg:right-4"
      aria-label={t("memoList.uploadTasksTitle")}
      aria-live="polite"
    >
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
        <FileUp className="h-4 w-4 text-slate-600" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{t("memoList.uploadTasksTitle")}</h2>
        <span className="text-xs tabular-nums text-slate-500">{tasks.length}</span>
      </header>
      <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
        {tasks.map((task) => {
          const active = task.status === "preparing" || task.status === "uploading";
          const progress = task.byteSize > 0
            ? Math.max(0, Math.min(100, Math.round((task.uploadedBytes / task.byteSize) * 100)))
            : 0;
          return (
            <article key={task.id} className="px-3 py-3">
              <div className="flex items-start gap-2.5">
                {active ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-600" aria-hidden="true" />
                ) : task.status === "completed" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                ) : (
                  <AlertCircle className={cn("mt-0.5 h-4 w-4 shrink-0", task.status === "failed" ? "text-rose-600" : "text-slate-400")} aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{task.filename}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t(statusKey(task.status))} · {formatBytes(task.uploadedBytes)} / {formatBytes(task.byteSize)}
                  </p>
                  {active ? (
                    <div
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
                      role="progressbar"
                      aria-label={task.filename}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                    >
                      <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
                    </div>
                  ) : null}
                </div>
                {active ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onCancel(task.id)}>
                    {t("memoList.uploadTaskCancel")}
                  </Button>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    {task.status === "completed" && task.memoId ? (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpen(task.memoId!)}>
                        {t("memoList.openMemo")}
                      </Button>
                    ) : null}
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
                      aria-label={t("memoList.uploadTaskDismiss")}
                      onClick={() => onDismiss(task.id)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
