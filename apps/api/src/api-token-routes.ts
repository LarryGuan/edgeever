import {
  ApiTokenCreateSchema,
  ApiTokenUpdateSchema,
  type ApiToken,
  type CreatedApiToken,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { auditStatement } from "./audit";
import type { AppEnv } from "./api-context";
import { randomToken } from "./auth-crypto";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { badRequest, notFound } from "./http-errors";
import {
  ALL_TOKEN_SCOPES,
  getAuditActor,
  getWorkspaceId,
  normalizeTokenScopes,
  requireUser,
} from "./request-auth";
import type { DatabaseAdapter } from "./storage-contract";

const API_TOKEN_BYTES = 32;
const API_TOKEN_PREFIX = "eev";
export const MULTI_NOTEBOOK_SCOPE_SENTINEL = "__mcp_multiple_notebooks__";

export type ApiTokenRow = {
  id: string;
  name: string;
  token_value: string | null;
  scopes_json: string;
  last_used_at: string | null;
  expires_at: string | null;
  is_revoked: number;
  created_at: string;
  workspace_id: string;
  mcp_notebook_id: string | null;
  mcp_scope_mode?: "all" | "notebooks";
  mcp_notebook_ids_json?: string | null;
};

type ApiTokenRouteDependencies = {
  sha256: (value: string) => Promise<string>;
};

export const mapApiToken = (row: ApiTokenRow): ApiToken => {
  const storedIds = parseJsonArray(row.mcp_notebook_ids_json ?? "[]");
  const legacyId = row.mcp_notebook_id && row.mcp_notebook_id !== MULTI_NOTEBOOK_SCOPE_SENTINEL
    ? row.mcp_notebook_id
    : null;
  const mcpNotebookIds = storedIds.length > 0 ? storedIds : legacyId ? [legacyId] : [];
  const mcpScopeMode = row.mcp_scope_mode ?? (legacyId || row.mcp_notebook_id === MULTI_NOTEBOOK_SCOPE_SENTINEL ? "notebooks" : "all");
  return {
    id: row.id,
    name: row.name,
    token: row.token_value,
    scopes: parseJsonArray(row.scopes_json),
    mcpScopeMode,
    mcpNotebookIds,
    mcpNotebookId: mcpNotebookIds.length === 1 ? mcpNotebookIds[0] : null,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    isRevoked: Boolean(row.is_revoked),
    createdAt: row.created_at,
  };
};

const apiTokenSelectSql = `
  SELECT t.id, t.name, t.token_value, t.scopes_json, t.last_used_at, t.expires_at,
         t.is_revoked, t.created_at, t.workspace_id, t.mcp_notebook_id, t.mcp_scope_mode,
         COALESCE((
           SELECT json_group_array(scope.notebook_id)
           FROM api_token_notebook_scopes scope
           WHERE scope.token_id = t.id
         ), '[]') AS mcp_notebook_ids_json
  FROM api_tokens t`;

const getApiTokenRow = (
  database: DatabaseAdapter,
  id: string,
  workspaceId: string,
) => database.prepare(
  `${apiTokenSelectSql}
   WHERE t.id = ? AND t.workspace_id = ?`,
).bind(id, workspaceId).first<ApiTokenRow>();

const normalizeNotebookScope = async (
  database: DatabaseAdapter,
  workspaceId: string,
  mode: "all" | "notebooks",
  requestedIds: string[],
) => {
  if (mode === "all") return [];
  const uniqueIds = [...new Set(requestedIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return null;

  const rows = await database.prepare(
    `SELECT id, parent_id FROM notebooks WHERE workspace_id = ? AND is_deleted = 0`,
  ).bind(workspaceId).all<{ id: string; parent_id: string | null }>();
  const parentById = new Map(rows.results.map((row) => [row.id, row.parent_id]));
  if (uniqueIds.some((id) => !parentById.has(id))) return null;

  const selected = new Set(uniqueIds);
  return uniqueIds.filter((id) => {
    const visited = new Set<string>();
    let parentId = parentById.get(id) ?? null;
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
    return true;
  });
};

const legacyScopeValue = (mode: "all" | "notebooks", notebookIds: string[]) => {
  if (mode === "all") return null;
  return notebookIds.length === 1 ? notebookIds[0] : MULTI_NOTEBOOK_SCOPE_SENTINEL;
};

export const registerApiTokenRoutes = (
  app: Hono<AppEnv>,
  dependencies: ApiTokenRouteDependencies,
) => {
  app.get("/api/v1/api-tokens", async (context) => {
    const userOnly = requireUser(context);
    if (userOnly) return userOnly;

    const rows = await context.env.storage.db.prepare(
      `${apiTokenSelectSql}
       WHERE t.workspace_id = ?
       ORDER BY t.is_revoked ASC, t.created_at DESC
       LIMIT 200`,
    ).bind(getWorkspaceId(context)).all<ApiTokenRow>();

    return context.json({
      apiTokens: rows.results.map(mapApiToken),
      availableScopes: ALL_TOKEN_SCOPES,
    });
  });

  app.post(
    "/api/v1/api-tokens",
    zValidator("json", ApiTokenCreateSchema),
    async (context) => {
      const userOnly = requireUser(context);
      if (userOnly) return userOnly;

      const input = context.req.valid("json");
      const scopes = normalizeTokenScopes(input.scopes);
      if (!scopes) return badRequest(context, "Token scope is not supported.");

      const id = createId("tok");
      const token = `${API_TOKEN_PREFIX}_${randomToken(API_TOKEN_BYTES)}`;
      const now = isoNow();
      const actor = getAuditActor(context);
      const workspaceId = getWorkspaceId(context);
      const requestedNotebookIds = input.mcpNotebookId
        ? [input.mcpNotebookId]
        : input.mcpNotebookIds ?? [];
      const mcpScopeMode = input.mcpScopeMode
        ?? (input.mcpNotebookId || requestedNotebookIds.length > 0 ? "notebooks" : "all");
      const mcpNotebookIds = await normalizeNotebookScope(
        context.env.storage.db,
        workspaceId,
        mcpScopeMode,
        requestedNotebookIds,
      );
      if (!mcpNotebookIds) return badRequest(context, "MCP notebook scope is not available.");
      const statements = [
        context.env.storage.db.prepare(
          `INSERT INTO api_tokens (
             id, workspace_id, name, token_hash, token_value, scopes_json, expires_at,
             created_at, mcp_notebook_id, mcp_scope_mode
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          workspaceId,
          input.name,
          await dependencies.sha256(token),
          token,
          JSON.stringify(scopes),
          input.expiresAt ?? null,
          now,
          legacyScopeValue(mcpScopeMode, mcpNotebookIds),
          mcpScopeMode,
        ),
        ...mcpNotebookIds.map((notebookId) => context.env.storage.db.prepare(
          `INSERT INTO api_token_notebook_scopes (token_id, notebook_id) VALUES (?, ?)`,
        ).bind(id, notebookId)),
        auditStatement(
          context.env.storage.db,
          actor.actorType,
          actor.actorId,
          "api_token.create",
          "api_token",
          id,
          { name: input.name, scopes, expiresAt: input.expiresAt ?? null, mcpScopeMode, mcpNotebookIds },
        ),
      ];
      await context.env.storage.db.batch(statements);

      const row = await getApiTokenRow(context.env.storage.db, id, workspaceId);
      if (!row) return notFound(context, "API token not found");
      return context.json({ token, apiToken: mapApiToken(row) } satisfies CreatedApiToken, 201);
    },
  );

  app.patch(
    "/api/v1/api-tokens/:id",
    zValidator("json", ApiTokenUpdateSchema),
    async (context) => {
      const userOnly = requireUser(context);
      if (userOnly) return userOnly;

      const id = context.req.param("id");
      const workspaceId = getWorkspaceId(context);
      const beforeRow = await getApiTokenRow(context.env.storage.db, id, workspaceId);
      if (!beforeRow) return notFound(context, "API token not found");

      const input = context.req.valid("json");
      const before = mapApiToken(beforeRow);
      const scopes = input.scopes === undefined ? before.scopes : normalizeTokenScopes(input.scopes);
      if (!scopes) return badRequest(context, "Token scope is not supported.");
      const mcpNotebookIds = await normalizeNotebookScope(
        context.env.storage.db,
        workspaceId,
        input.mcpScopeMode,
        input.mcpNotebookIds,
      );
      if (!mcpNotebookIds) return badRequest(context, "MCP notebook scope is not available.");

      const actor = getAuditActor(context);
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `UPDATE api_tokens
           SET name = ?, scopes_json = ?, mcp_scope_mode = ?, mcp_notebook_id = ?
           WHERE id = ? AND workspace_id = ?`,
        ).bind(
          input.name ?? before.name,
          JSON.stringify(scopes),
          input.mcpScopeMode,
          legacyScopeValue(input.mcpScopeMode, mcpNotebookIds),
          id,
          workspaceId,
        ),
        context.env.storage.db.prepare(
          `DELETE FROM api_token_notebook_scopes WHERE token_id = ?`,
        ).bind(id),
        ...mcpNotebookIds.map((notebookId) => context.env.storage.db.prepare(
          `INSERT INTO api_token_notebook_scopes (token_id, notebook_id) VALUES (?, ?)`,
        ).bind(id, notebookId)),
        auditStatement(
          context.env.storage.db,
          actor.actorType,
          actor.actorId,
          "api_token.update",
          "api_token",
          id,
          {
            before: {
              name: before.name,
              scopes: before.scopes,
              mcpScopeMode: before.mcpScopeMode,
              mcpNotebookIds: before.mcpNotebookIds,
            },
            after: {
              name: input.name ?? before.name,
              scopes,
              mcpScopeMode: input.mcpScopeMode,
              mcpNotebookIds,
            },
          },
        ),
      ]);

      const row = await getApiTokenRow(context.env.storage.db, id, workspaceId);
      if (!row) return notFound(context, "API token not found");
      return context.json({ apiToken: mapApiToken(row) });
    },
  );

  app.delete("/api/v1/api-tokens/:id", async (context) => {
    const userOnly = requireUser(context);
    if (userOnly) return userOnly;

    const id = context.req.param("id");
    const actor = getAuditActor(context);
    await context.env.storage.db.batch([
      context.env.storage.db.prepare(
        `DELETE FROM api_tokens WHERE id = ? AND workspace_id = ?`,
      ).bind(id, getWorkspaceId(context)),
      auditStatement(
        context.env.storage.db,
        actor.actorType,
        actor.actorId,
        "api_token.delete",
        "api_token",
        id,
        {},
      ),
    ]);
    return context.json({ ok: true });
  });
};
