import { useEffect, useState, useSyncExternalStore } from "react";
import type { PluginPanelChrome, PluginPanelCloseDecision } from "@edgeever/plugin-api";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppConfirmDialog } from "@/components/dialogs/ConfirmDialogs";
import { PluginPanelEmpty, PluginPanelHeaderActions, PluginPanelToolbar } from "@/components/plugins/PluginPanelChrome";
import { Button } from "@/components/ui/button";
import type { EdgeEverPluginHost, RegisteredPluginPanel } from "@/lib/plugins/plugin-host";

export const PluginSidebarPanel = ({ host, panel, onClose }: {
  host: EdgeEverPluginHost;
  panel: RegisteredPluginPanel;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [chrome, setChrome] = useState<PluginPanelChrome>({});
  const [mountError, setMountError] = useState<string | null>(null);
  const [closeConfirmation, setCloseConfirmation] = useState<Exclude<PluginPanelCloseDecision, boolean> | null>(null);
  const [checkingClose, setCheckingClose] = useState(false);
  const registered = snapshot.panels.some((candidate) => candidate.pluginId === panel.pluginId && candidate.id === panel.id);

  useEffect(() => {
    if (!registered) onClose();
  }, [onClose, registered]);

  useEffect(() => {
    if (!container || !registered) return;
    let disposed = false;
    let disposePanel: (() => void) | null = null;
    setChrome({});
    setMountError(null);
    container.replaceChildren();
    void host.mountPanel(panel.pluginId, panel.id, container, undefined, onClose, {
      set(next) {
        if (!disposed) setChrome(next);
      },
    }).then((dispose) => {
      if (disposed) dispose();
      else disposePanel = dispose;
    }).catch((error: unknown) => {
      if (!disposed) setMountError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      disposed = true;
      disposePanel?.();
      container.replaceChildren();
    };
  }, [container, host, onClose, panel.id, panel.pluginId, registered]);

  const requestClose = async () => {
    if (checkingClose) return;
    setCheckingClose(true);
    try {
      const decision = await host.getPanelCloseDecision(panel.pluginId, panel.id);
      if (decision === true) onClose();
      else if (decision && typeof decision === "object") setCloseConfirmation(decision);
    } catch (error) {
      setMountError(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingClose(false);
    }
  };

  const title = chrome.header?.title || panel.title;
  const description = chrome.header?.description;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-card" aria-label={title} data-plugin-sidebar-panel>
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-3 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-950">{title}</h2>
          {description ? <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-slate-500">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PluginPanelHeaderActions chrome={chrome} />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={t("common.close")}
            disabled={checkingClose}
            onClick={() => void requestClose()}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>
      {chrome.toolbar?.length ? (
        <div className="shrink-0 border-b border-slate-100 px-3 py-2">
          <PluginPanelToolbar chrome={chrome} />
        </div>
      ) : null}
      {mountError ? <div role="alert" className="mx-3 mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{mountError}</div> : null}
      {chrome.empty ? <PluginPanelEmpty chrome={chrome} /> : null}
      <div ref={setContainer} hidden={Boolean(chrome.empty)} className="min-h-0 flex-1 overflow-auto" />
      {closeConfirmation ? (
        <AppConfirmDialog
          title={closeConfirmation.title}
          description={closeConfirmation.message}
          confirmLabel={closeConfirmation.confirmLabel ?? t("common.close")}
          tone="neutral"
          onCancel={() => setCloseConfirmation(null)}
          onConfirm={() => {
            setCloseConfirmation(null);
            onClose();
          }}
        />
      ) : null}
    </section>
  );
};
