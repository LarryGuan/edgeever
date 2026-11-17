import type { AppContext, AuthContext } from "./api-context";
import { callMcpTool } from "./mcp-tool-service";
import { clampNumber } from "./entity-utils";
import { prepareMcpNotebookScopedCall } from "./mcp-notebook-scope";
import { createMemoRecord, deleteMemosRecord, getCurrentWorkspaceIdentity, getMemoDetail, getMemoDetailRow,
  getMemosForBulkAction, importMemosRecord, listMemosForMcp, mergeMemosRecord, moveMemosToNotebook,
  restoreMemosRecord, searchMemoSummaries, updateMemoRecord } from "./memo-service";

// Both remote MCP and the built-in companion use this exact dispatcher.
export const executeWorkspaceTool = async (context: AppContext, auth: AuthContext, name: string, args: Record<string, unknown>) => {
  const scopedArgs = await prepareMcpNotebookScopedCall(context.env.storage.db, auth, name, args);
  return callMcpTool(context, auth, name, scopedArgs, { clampNumber, createMemoRecord, deleteMemosRecord,
    getCurrentWorkspaceIdentity, getMemoDetail, getMemoDetailRow, getMemosForBulkAction, importMemosRecord,
    listMemosForMcp, mergeMemosRecord, moveMemosToNotebook, restoreMemosRecord, searchMemoSummaries, updateMemoRecord });
};
