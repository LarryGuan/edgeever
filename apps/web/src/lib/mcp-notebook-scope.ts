import type { Notebook } from "@edgeever/shared";
import { buildNotebookTree } from "./utils";

export type VisibleNotebookScopeOption = {
  id: string;
  name: string;
  depth: number;
  hasChildren: boolean;
};

export const getVisibleNotebookScopeOptions = (
  notebooks: Notebook[],
  expandedIds: string[],
): VisibleNotebookScopeOption[] => {
  const expanded = new Set(expandedIds);
  const visible: VisibleNotebookScopeOption[] = [];

  const visit = (nodes: ReturnType<typeof buildNotebookTree>, depth: number) => {
    for (const node of nodes) {
      visible.push({
        id: node.id,
        name: node.name,
        depth,
        hasChildren: node.children.length > 0,
      });
      if (node.children.length > 0 && expanded.has(node.id)) {
        visit(node.children, depth + 1);
      }
    }
  };

  visit(buildNotebookTree(notebooks), 0);
  return visible;
};

const parentMap = (notebooks: Notebook[]) => new Map(notebooks.map((notebook) => [notebook.id, notebook.parentId]));

const hasSelectedAncestor = (
  notebookId: string,
  selected: Set<string>,
  parents: Map<string, string | null>,
) => {
  const visited = new Set<string>();
  let parentId = parents.get(notebookId) ?? null;
  while (parentId && !visited.has(parentId)) {
    if (selected.has(parentId)) return true;
    visited.add(parentId);
    parentId = parents.get(parentId) ?? null;
  }
  return false;
};

export const normalizeNotebookScopeRoots = (notebooks: Notebook[], notebookIds: string[]) => {
  const existing = new Set(notebooks.map((notebook) => notebook.id));
  const unique = [...new Set(notebookIds.filter((id) => existing.has(id)))];
  const selected = new Set(unique);
  const parents = parentMap(notebooks);
  return unique.filter((id) => !hasSelectedAncestor(id, selected, parents));
};

export const getNotebookScopeSelectionState = (
  notebooks: Notebook[],
  rootIds: string[],
  notebookId: string,
) => {
  const selected = new Set(normalizeNotebookScopeRoots(notebooks, rootIds));
  const parents = parentMap(notebooks);
  const explicit = selected.has(notebookId);
  const inherited = !explicit && hasSelectedAncestor(notebookId, selected, parents);
  const indeterminate = !explicit && !inherited && [...selected].some((selectedId) => {
    const visited = new Set<string>();
    let parentId = parents.get(selectedId) ?? null;
    while (parentId && !visited.has(parentId)) {
      if (parentId === notebookId) return true;
      visited.add(parentId);
      parentId = parents.get(parentId) ?? null;
    }
    return false;
  });
  return { checked: explicit || inherited, explicit, inherited, indeterminate };
};

export const toggleNotebookScopeRoot = (
  notebooks: Notebook[],
  rootIds: string[],
  notebookId: string,
) => {
  const normalized = normalizeNotebookScopeRoots(notebooks, rootIds);
  const state = getNotebookScopeSelectionState(notebooks, normalized, notebookId);
  if (state.inherited) return normalized;
  if (state.explicit) return normalized.filter((id) => id !== notebookId);
  return normalizeNotebookScopeRoots(notebooks, [...normalized, notebookId]);
};
