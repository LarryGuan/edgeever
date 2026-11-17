import type { AuthContext } from "./api-context";
import { AppError } from "./app-error";
import type { DatabaseAdapter } from "./storage-contract";

const SAFE_SCOPED_TOOLS = new Set([
  "get_current_user",
  "search_memos",
  "list_memos",
  "get_memo",
  "create_memo",
  "get_table_records",
  "create_table_memo",
  "update_table_schema",
  "add_table_record",
  "update_table_record",
  "delete_table_record",
  "create_infographic_memo",
  "create_diagram_memo",
  "create_poster_memo",
  "get_poster_capabilities",
  "get_poster_preview",
  "export_poster",
  "get_poster",
  "update_poster",
  "get_diagram",
  "update_diagram",
  "import_memos",
  "update_memo",
  "trash_memos",
  "restore_memos",
  "move_memos",
  "add_tags_to_memos",
  "remove_tags_from_memos",
  "merge_memos",
  "upload_memo_image",
  "create_resource_upload_url",
  "upload_memo_attachment",
  "list_memo_resources",
  "list_memo_revisions",
  "restore_memo_revision",
  "get_notebook",
  "list_notebooks",
]);

const FORCE_NOTEBOOK_TOOLS = new Set(["search_memos", "list_memos"]);
const NOTEBOOK_TARGET_TOOLS = new Set([
  "create_memo",
  "create_table_memo",
  "create_infographic_memo",
  "create_diagram_memo",
  "create_poster_memo",
  "import_memos",
]);
const MEMO_TARGET_TOOLS = new Set([
  "get_memo",
  "get_table_records",
  "update_table_schema",
  "add_table_record",
  "update_table_record",
  "delete_table_record",
  "get_poster_preview",
  "export_poster",
  "get_poster",
  "update_poster",
  "get_diagram",
  "update_diagram",
  "update_memo",
  "upload_memo_image",
  "upload_memo_attachment",
  "list_memo_resources",
  "list_memo_revisions",
  "restore_memo_revision",
]);
const MEMO_BATCH_TOOLS = new Set([
  "trash_memos",
  "restore_memos",
  "move_memos",
  "add_tags_to_memos",
  "remove_tags_from_memos",
  "merge_memos",
]);

const optionalString = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

export const getMcpNotebookScope = (auth: AuthContext) => {
  const rootIds = auth.mcpNotebookRootIds
    ?? (auth.mcpNotebookId ? [auth.mcpNotebookId] : []);
  const restricted = auth.mcpNotebookScopeMode === "notebooks" || rootIds.length > 0;
  const allowedIds = auth.mcpAllowedNotebookIds ?? rootIds;
  return { restricted, rootIds, allowedIds };
};

export const hasMcpNotebookScope = (auth: AuthContext) => getMcpNotebookScope(auth).restricted;

export const resolveMcpAllowedNotebookIds = async (
  database: DatabaseAdapter,
  workspaceId: string,
  rootIds: string[],
) => {
  if (rootIds.length === 0) return [];
  const rows = await database.prepare(
    `WITH RECURSIVE allowed(id) AS (
       SELECT n.id
       FROM notebooks n
       INNER JOIN json_each(?) roots ON roots.value = n.id
       WHERE n.workspace_id = ? AND n.is_deleted = 0

       UNION

       SELECT n.id
       FROM notebooks n
       INNER JOIN allowed parent ON n.parent_id = parent.id
       WHERE n.workspace_id = ? AND n.is_deleted = 0
     )
     SELECT id FROM allowed`,
  ).bind(JSON.stringify(rootIds), workspaceId, workspaceId).all<{ id: string }>();
  return rows.results.map((row) => row.id);
};

const requireNotebookTarget = (args: Record<string, unknown>, allowedIds: Set<string>) => {
  const notebookId = optionalString(args.notebookId);
  if (!notebookId || !allowedIds.has(notebookId)) {
    throw new AppError("not_found", "Notebook not found", 404);
  }
};

const requireMemoTargets = async (
  database: DatabaseAdapter,
  auth: AuthContext,
  memoIds: string[],
) => {
  const { allowedIds } = getMcpNotebookScope(auth);
  if (allowedIds.length === 0 || memoIds.length === 0) {
    throw new AppError("not_found", "Memo not found", 404);
  }
  const uniqueIds = [...new Set(memoIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length !== memoIds.length) {
    throw new AppError("not_found", "Memo not found", 404);
  }
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const row = await database.prepare(
    `SELECT COUNT(*) AS count
     FROM memos
     WHERE workspace_id = ?
       AND notebook_id IN (SELECT value FROM json_each(?))
       AND id IN (${placeholders})`,
  ).bind(auth.workspaceId, JSON.stringify(allowedIds), ...uniqueIds).first<{ count: number }>();
  if (Number(row?.count ?? 0) !== uniqueIds.length) {
    throw new AppError("not_found", "Memo not found", 404);
  }
};

export const isMcpToolAvailableForAuth = (auth: AuthContext, name: string) =>
  !hasMcpNotebookScope(auth) || SAFE_SCOPED_TOOLS.has(name);

export const prepareMcpNotebookScopedCall = async (
  database: DatabaseAdapter,
  auth: AuthContext,
  name: string,
  input: Record<string, unknown>,
) => {
  const scope = getMcpNotebookScope(auth);
  if (!scope.restricted) return input;
  if (!SAFE_SCOPED_TOOLS.has(name)) {
    throw new AppError("forbidden", "This tool is unavailable to a notebook-scoped MCP token.", 403);
  }

  const args = { ...input };
  const allowedIds = new Set(scope.allowedIds);
  if (FORCE_NOTEBOOK_TOOLS.has(name)) {
    const requested = optionalString(args.notebookId);
    if (requested && !allowedIds.has(requested)) {
      throw new AppError("not_found", "Notebook not found", 404);
    }
  }

  if (NOTEBOOK_TARGET_TOOLS.has(name)) requireNotebookTarget(args, allowedIds);

  if (name === "get_notebook") requireNotebookTarget(args, allowedIds);

  if (MEMO_TARGET_TOOLS.has(name)) {
    const memoId = optionalString(args.memoId);
    if (!memoId) throw new AppError("not_found", "Memo not found", 404);
    await requireMemoTargets(database, auth, [memoId]);
    if (name === "update_memo" && args.notebookId !== undefined) {
      requireNotebookTarget(args, allowedIds);
    }
  }

  if (MEMO_BATCH_TOOLS.has(name)) {
    if (!Array.isArray(args.memoIds) || args.memoIds.some((id) => typeof id !== "string")) {
      throw new AppError("not_found", "Memo not found", 404);
    }
    await requireMemoTargets(database, auth, args.memoIds as string[]);
    if ((name === "move_memos" || name === "merge_memos") && args.notebookId !== undefined) {
      requireNotebookTarget(args, allowedIds);
    }
  }

  return args;
};
