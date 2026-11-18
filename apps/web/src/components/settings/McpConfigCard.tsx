import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Copy, KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { ApiToken, Notebook } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SETTINGS_CARD_DESCRIPTION_CLASSNAME,
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import {
  getNotebookScopeSelectionState,
  getVisibleNotebookScopeOptions,
  toggleNotebookScopeRoot,
} from "@/lib/mcp-notebook-scope";
import { cn, formatDateTime } from "@/lib/utils";
import { AppConfirmDialog } from "@/components/dialogs/ConfirmDialogs";
import {
  ALL_TOKEN_SCOPES,
  buildMcpRemoteConfig,
  copyTextToClipboard,
  createDefaultTokenName,
  DEFAULT_TOKEN_ACCESS_LEVEL,
  getMcpRemoteServerUrl,
  getStoredTokenAccessLevel,
  getTokenScopesForAccessLevel,
  getTokenScopeLabel,
  type StoredTokenAccessLevel,
  type TokenAccessLevel,
} from "./settings-utils";

const McpExampleDialog = () => {
  const { t } = useTranslation();
  const serverUrl = getMcpRemoteServerUrl();
  const [copied, setCopied] = useState(false);
  const remoteExample = JSON.stringify(
    {
      mcpServers: {
        edgeever: {
          url: serverUrl,
          headers: {
            Authorization: t("mcp.bearerPlaceholder"),
          },
        },
      },
    },
    null,
    2
  );

  const handleCopy = async () => {
    if (!(await copyTextToClipboard(remoteExample))) {
      return;
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 bg-card px-2.5 text-xs" type="button">
          {t("mcp.example")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl gap-3 p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>{t("mcp.exampleTitle")}</DialogTitle>
        </DialogHeader>
        <pre className="max-h-[55vh] overflow-auto rounded-md border border-slate-100 bg-slate-950 p-3 text-left text-xs leading-5 text-slate-100 sm:text-xs">
          <code>{remoteExample}</code>
        </pre>
        <div className="flex justify-end">
          <Button
            size="md"
            variant="solid"
            type="button"
            onClick={() => void handleCopy()}
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? t("common.copied") : t("mcp.copyExample")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface AccessLevelPickerProps {
  value: StoredTokenAccessLevel;
  onChange: (accessLevel: TokenAccessLevel) => void;
  inputName: string;
}

const AccessLevelPicker = ({ value, onChange, inputName }: AccessLevelPickerProps) => {
  const { t } = useTranslation();
  const options: TokenAccessLevel[] = ["full", "read-only"];

  return (
    <TooltipProvider>
      <div
        role="radiogroup"
        aria-label={t("mcp.accessLevelTitle")}
        className="inline-flex h-9 shrink-0 items-center rounded-md bg-slate-200/70 p-0.5"
      >
        {options.map((option) => {
          const checked = value === option;
          const inputId = `${inputName}-${option}`;

          return (
            <Tooltip key={option}>
              <TooltipTrigger asChild>
                <label
                  htmlFor={inputId}
                  className={cn(
                    "flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-normal transition-all focus-within:ring-2 focus-within:ring-slate-900/15",
                    checked
                      ? "bg-card text-slate-950 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <input
                    id={inputId}
                    className="sr-only"
                    type="radio"
                    name={inputName}
                    value={option}
                    checked={checked}
                    onChange={() => onChange(option)}
                  />
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 rounded-full", checked ? "bg-slate-950" : "bg-slate-400")}
                  />
                  {t(`mcp.accessLevels.${option}.label`)}
                </label>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72 leading-4 text-xs">
                {t(`mcp.accessLevels.${option}.description`)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
};

type NotebookScopeMode = "all" | "notebooks";

interface NotebookScopePickerProps {
  notebooks: Notebook[];
  mode: NotebookScopeMode;
  notebookIds: string[];
  onChange: (mode: NotebookScopeMode, notebookIds: string[]) => void;
}

const NotebookScopePicker = ({ notebooks, mode, notebookIds, onChange }: NotebookScopePickerProps) => {
  const { t } = useTranslation();
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const options = getVisibleNotebookScopeOptions(notebooks, expandedIds);
  const summary = mode === "all"
    ? t("mcp.allNotebooks")
    : notebookIds.length > 0
      ? t("mcp.selectedNotebookScopes", { count: notebookIds.length })
      : t("mcp.selectNotebooks");

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) setExpandedIds([]); }}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full justify-between bg-card px-3 text-xs font-normal sm:w-56"
          aria-label={t("mcp.notebookScopeTitle")}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuCheckboxItem
          checked={mode === "all"}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={() => onChange("all", [])}
        >
          {t("mcp.allNotebooks")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {options.map((option) => {
          const expanded = expandedIds.includes(option.id);
          const state = mode === "notebooks"
            ? getNotebookScopeSelectionState(notebooks, notebookIds, option.id)
            : { checked: false, explicit: false, inherited: false, indeterminate: false };
          return (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={state.indeterminate ? "indeterminate" : state.checked}
              aria-disabled={state.inherited}
              className="pr-2"
              style={{ paddingLeft: `${32 + option.depth * 16}px` }}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => onChange(
                "notebooks",
                toggleNotebookScopeRoot(notebooks, mode === "notebooks" ? notebookIds : [], option.id),
              )}
            >
              {option.hasChildren ? (
                <button
                  type="button"
                  className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-slate-500 hover:bg-slate-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
                  aria-expanded={expanded}
                  aria-label={t(expanded ? "mcp.collapseNotebook" : "mcp.expandNotebook", { name: option.name })}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setExpandedIds((current) => expanded
                      ? current.filter((id) => id !== option.id)
                      : [...current, option.id]);
                  }}
                >
                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              ) : (
                <span className="mr-1 h-5 w-5 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{option.name}</span>
              {state.inherited ? <span className="ml-auto text-[10px] text-slate-400">{t("mcp.inheritedScope")}</span> : null}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface TokenListProps {
  tokens: ApiToken[];
  notebooks: Notebook[];
  availableScopes: string[];
  newlyCreatedTokenId: string | null;
  isLoading: boolean;
  isDeleting: boolean;
  onEdit: (token: ApiToken) => void;
  onDelete: (token: ApiToken) => void;
}

const TokenList = ({ tokens, notebooks, availableScopes, newlyCreatedTokenId, isLoading, isDeleting, onEdit, onDelete }: TokenListProps) => {
  const { t } = useTranslation();
  const [copiedAction, setCopiedAction] = useState<{ tokenId: string; action: "token" | "config" } | null>(null);

  const handleCopy = async (token: ApiToken, action: "token" | "config") => {
    if (!token.token) {
      return;
    }

    const value = action === "token" ? token.token : buildMcpRemoteConfig(token.token);
    if (!(await copyTextToClipboard(value))) {
      return;
    }

    setCopiedAction({ tokenId: token.id, action });
    window.setTimeout(() => {
      setCopiedAction((current) => (current?.tokenId === token.id && current.action === action ? null : current));
    }, 1600);
  };

  if (isLoading) {
    return (
      <p className="py-4 text-center text-xs text-slate-400">{t("mcp.loadingTokens")}</p>
    );
  }

  if (tokens.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
        {t("mcp.emptyTokens")}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 divide-y divide-slate-100 bg-card">
      {tokens.map((token) => {
        const accessLevel = getStoredTokenAccessLevel(token.scopes, availableScopes);
        const accessLabel = accessLevel === "legacy-custom"
          ? t("mcp.accessLevels.legacy-custom.label")
          : t(`mcp.accessLevels.${accessLevel}.label`);
        const scopedNotebookIds = token.mcpNotebookIds.length > 0
          ? token.mcpNotebookIds
          : token.mcpNotebookId ? [token.mcpNotebookId] : [];
        const scopedNotebookNames = scopedNotebookIds.map(
          (id) => notebooks.find((notebook) => notebook.id === id)?.name ?? id,
        );
        const scopeBadge = scopedNotebookNames.length > 2
          ? `${scopedNotebookNames.slice(0, 2).join("、")} +${scopedNotebookNames.length - 2}`
          : scopedNotebookNames.join("、");

        return (
          <div
            key={token.id}
            className={cn(
              "flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between transition-colors sm:p-4",
              token.isRevoked ? "bg-slate-50/50 opacity-60" : "hover:bg-slate-50/40",
              token.id === newlyCreatedTokenId && "edgeever-token-created",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-xs font-normal text-slate-900">{token.name}</span>
                {accessLevel === "legacy-custom" ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="cursor-help rounded-md border border-slate-200/80 bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/15"
                          tabIndex={0}
                        >
                          {accessLabel}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        {token.scopes.map((scope) => getTokenScopeLabel(scope, t)).join(", ")}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-normal",
                      accessLevel === "full"
                        ? "border border-slate-200 bg-slate-100 text-slate-700"
                        : "border border-slate-200/80 bg-slate-100 text-slate-600"
                    )}
                  >
                    {accessLabel}
                  </span>
                )}
                {token.mcpScopeMode === "notebooks" ? (
                  <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-normal text-emerald-700">
                    {t("mcp.notebookScopeBadge", { name: scopeBadge || t("mcp.noAvailableNotebookScope") })}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>
                  {token.lastUsedAt ? t("mcp.lastUsedAt", { time: formatDateTime(token.lastUsedAt) }) : t("mcp.neverUsed")}
                </span>
                {!token.token ? (
                  <span className="text-amber-600">· {t("mcp.legacyTokenHint")}</span>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 border-slate-200 bg-card px-2.5 text-xs font-normal text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                      aria-label={token.token ? t("mcp.copyToken") : t("mcp.legacyTokenCannotCopy")}
                      disabled={token.isRevoked || !token.token}
                      onClick={() => void handleCopy(token, "token")}
                    >
                      {copiedAction?.tokenId === token.id && copiedAction.action === "token" ? (
                        <>
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="font-medium text-emerald-700">{t("common.copied")}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-slate-500" />
                          <span>{t("mcp.copyToken")}</span>
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{token.token ? t("mcp.copyToken") : t("mcp.legacyTokenCannotCopy")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 border-slate-200 bg-card px-2.5 text-xs font-normal text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                      aria-label={token.token ? t("mcp.copyConfig") : t("mcp.legacyConfigCannotCopy")}
                      disabled={token.isRevoked || !token.token}
                      onClick={() => void handleCopy(token, "config")}
                    >
                      {copiedAction?.tokenId === token.id && copiedAction.action === "config" ? (
                        <>
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="font-medium text-emerald-700">{t("common.copied")}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-slate-500" />
                          <span>{t("mcp.copyConfig")}</span>
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{token.token ? t("mcp.copyConfig") : t("mcp.legacyConfigCannotCopy")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label={t("mcp.editToken")}
                      disabled={token.isRevoked}
                      onClick={() => onEdit(token)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("mcp.editToken")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label={t("mcp.deleteToken")}
                      disabled={isDeleting}
                      onClick={() => onDelete(token)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("mcp.deleteToken")}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const McpConfigCard = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(() => createDefaultTokenName());
  const [accessLevel, setAccessLevel] = useState<TokenAccessLevel>(DEFAULT_TOKEN_ACCESS_LEVEL);
  const [mcpScopeMode, setMcpScopeMode] = useState<NotebookScopeMode>("all");
  const [mcpNotebookIds, setMcpNotebookIds] = useState<string[]>([]);
  const [newlyCreatedTokenId, setNewlyCreatedTokenId] = useState<string | null>(null);
  const [tokenScopeEdit, setTokenScopeEdit] = useState<ApiToken | null>(null);
  const [editName, setEditName] = useState("");
  const [editAccessLevel, setEditAccessLevel] = useState<StoredTokenAccessLevel>(DEFAULT_TOKEN_ACCESS_LEVEL);
  const [editAccessChanged, setEditAccessChanged] = useState(false);
  const [editScopeMode, setEditScopeMode] = useState<NotebookScopeMode>("all");
  const [editNotebookIds, setEditNotebookIds] = useState<string[]>([]);
  const [tokenDeleteConfirmation, setTokenDeleteConfirmation] = useState<ApiToken | null>(null);

  const tokensQuery = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => api.listApiTokens(),
  });

  const availableScopes = tokensQuery.data?.availableScopes ?? ALL_TOKEN_SCOPES;
  const tokens = tokensQuery.data?.apiTokens ?? [];
  const notebooksQuery = useQuery({
    queryKey: ["notebooks", "mcp-token-scope"],
    queryFn: () => api.listNotebooks(),
  });
  const notebooks = notebooksQuery.data?.notebooks ?? [];

  const createMutation = useMutation({
    mutationFn: api.createApiToken,
    onSuccess: async (data) => {
      setNewlyCreatedTokenId(data.apiToken.id);
      setName(createDefaultTokenName());
      setAccessLevel(DEFAULT_TOKEN_ACCESS_LEVEL);
      setMcpScopeMode("all");
      setMcpNotebookIds([]);
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const deleteTokenMutation = useMutation({
    mutationFn: api.revokeApiToken,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const updateTokenMutation = useMutation({
    mutationFn: ({ tokenId, tokenName, scopes, mode, notebookIds }: {
      tokenId: string;
      tokenName: string;
      scopes?: string[];
      mode: NotebookScopeMode;
      notebookIds: string[];
    }) => api.updateApiToken(tokenId, {
      name: tokenName,
      ...(scopes ? { scopes } : {}),
      mcpScopeMode: mode,
      mcpNotebookIds: notebookIds,
    }),
    onSuccess: async () => {
      setTokenScopeEdit(null);
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const openScopeEditor = (token: ApiToken) => {
    const notebookIds = token.mcpNotebookIds.length > 0
      ? token.mcpNotebookIds
      : token.mcpNotebookId ? [token.mcpNotebookId] : [];
    setTokenScopeEdit(token);
    setEditName(token.name);
    setEditAccessLevel(getStoredTokenAccessLevel(token.scopes, availableScopes));
    setEditAccessChanged(false);
    setEditScopeMode(token.mcpScopeMode);
    setEditNotebookIds(notebookIds);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const scopes = getTokenScopesForAccessLevel(accessLevel, availableScopes);

    if (!name.trim()) {
      return;
    }
    if (mcpScopeMode === "notebooks" && mcpNotebookIds.length === 0) return;

    createMutation.mutate({
      name: name.trim(),
      scopes,
      mcpScopeMode,
      mcpNotebookIds,
    });
  };

  return (
    <>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
                <KeyRound className={SETTINGS_CARD_ICON_CLASSNAME} />
                {t("mcp.title")}
              </CardTitle>
              <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>{t("mcp.description")}</CardDescription>
            </div>
            <McpExampleDialog />
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 p-4 pt-0 sm:px-5 sm:pb-5">
          <div className="rounded-lg border border-slate-200/70 bg-slate-50/50 p-3 sm:p-3.5">
            <form className="flex flex-col gap-2.5 sm:flex-row sm:items-center" onSubmit={handleSubmit}>
              <Input
                className="h-9 min-w-0 flex-1 bg-card text-xs"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("mcp.namePlaceholder")}
              />
              <NotebookScopePicker
                notebooks={notebooks}
                mode={mcpScopeMode}
                notebookIds={mcpNotebookIds}
                onChange={(mode, notebookIds) => {
                  setMcpScopeMode(mode);
                  setMcpNotebookIds(notebookIds);
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <AccessLevelPicker
                  value={accessLevel}
                  onChange={setAccessLevel}
                  inputName="token-access-create"
                />
                <Button
                  size="sm"
                  variant="solid"
                  className="h-9 shrink-0 gap-1 px-3.5 text-xs font-normal"
                  type="submit"
                  disabled={createMutation.isPending || !name.trim() || (mcpScopeMode === "notebooks" && mcpNotebookIds.length === 0)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("mcp.createToken")}
                </Button>
              </div>
            </form>
          </div>

          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-normal text-slate-500">
                  {t("mcp.activeTokens")}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">
                  {tokens.length}
                </span>
              </div>
            </div>
            <TokenList
              tokens={tokens}
              notebooks={notebooks}
              availableScopes={availableScopes}
              newlyCreatedTokenId={newlyCreatedTokenId}
              isLoading={tokensQuery.isLoading}
              isDeleting={deleteTokenMutation.isPending}
              onEdit={openScopeEditor}
              onDelete={setTokenDeleteConfirmation}
            />
          </section>
        </CardContent>
      </Card>

      <Dialog open={Boolean(tokenScopeEdit)} onOpenChange={(open) => { if (!open) setTokenScopeEdit(null); }}>
        <DialogContent className="max-w-md gap-4 p-5">
          <DialogHeader>
            <DialogTitle>{t("mcp.editTokenTitle", { name: tokenScopeEdit?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("mcp.editTokenDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-xs text-slate-700">
              <span>{t("mcp.tokenName")}</span>
              <Input
                value={editName}
                maxLength={80}
                onChange={(event) => setEditName(event.target.value)}
              />
            </label>
            <div className="grid gap-1.5">
              <span className="text-xs text-slate-700">{t("mcp.accessLevelTitle")}</span>
              <AccessLevelPicker
                value={editAccessLevel}
                inputName="token-access-edit"
                onChange={(nextAccessLevel) => {
                  setEditAccessLevel(nextAccessLevel);
                  setEditAccessChanged(true);
                }}
              />
              {editAccessLevel === "legacy-custom" && !editAccessChanged ? (
                <p className="text-xs text-amber-700">{t("mcp.legacyAccessPreserved")}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <span className="text-xs text-slate-700">{t("mcp.notebookScopeTitle")}</span>
              <NotebookScopePicker
                notebooks={notebooks}
                mode={editScopeMode}
                notebookIds={editNotebookIds}
                onChange={(mode, notebookIds) => {
                  setEditScopeMode(mode);
                  setEditNotebookIds(notebookIds);
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTokenScopeEdit(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="solid"
              disabled={updateTokenMutation.isPending || !editName.trim() || (editScopeMode === "notebooks" && editNotebookIds.length === 0)}
              onClick={() => {
                if (!tokenScopeEdit) return;
                updateTokenMutation.mutate({
                  tokenId: tokenScopeEdit.id,
                  tokenName: editName.trim(),
                  scopes: editAccessChanged && editAccessLevel !== "legacy-custom"
                    ? getTokenScopesForAccessLevel(editAccessLevel, availableScopes)
                    : undefined,
                  mode: editScopeMode,
                  notebookIds: editNotebookIds,
                });
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tokenDeleteConfirmation && (
        <AppConfirmDialog
          title={t("mcp.deleteConfirmTitle", { name: tokenDeleteConfirmation.name })}
          description={t("mcp.deleteConfirmDescription")}
          confirmLabel={t("mcp.deleteConfirmLabel")}
          isWorking={deleteTokenMutation.isPending}
          tone="danger"
          onCancel={() => setTokenDeleteConfirmation(null)}
          onConfirm={() => {
            deleteTokenMutation.mutate(tokenDeleteConfirmation.id, {
              onSuccess: () => setTokenDeleteConfirmation(null),
            });
          }}
        />
      )}
    </>
  );
};
