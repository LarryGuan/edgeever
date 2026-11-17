import { describe, expect, test } from "bun:test";
import {
  getNotebookScopeSelectionState,
  normalizeNotebookScopeRoots,
  toggleNotebookScopeRoot,
} from "./mcp-notebook-scope.ts";

const notebook = (id, parentId = null) => ({ id, parentId });
const notebooks = [
  notebook("work"),
  notebook("projects", "work"),
  notebook("alpha", "projects"),
  notebook("personal"),
];

describe("MCP notebook scope picker", () => {
  test("collapses redundant descendants when a parent is selected", () => {
    expect(normalizeNotebookScopeRoots(notebooks, ["alpha", "personal", "work"]))
      .toEqual(["personal", "work"]);
  });

  test("marks descendants as inherited and parents as partially selected", () => {
    expect(getNotebookScopeSelectionState(notebooks, ["work"], "alpha"))
      .toMatchObject({ checked: true, inherited: true, indeterminate: false });
    expect(getNotebookScopeSelectionState(notebooks, ["alpha"], "work"))
      .toMatchObject({ checked: false, inherited: false, indeterminate: true });
  });

  test("selecting a parent replaces selected descendants without broadening other roots", () => {
    expect(toggleNotebookScopeRoot(notebooks, ["alpha", "personal"], "work"))
      .toEqual(["personal", "work"]);
    expect(toggleNotebookScopeRoot(notebooks, ["work", "personal"], "work"))
      .toEqual(["personal"]);
  });
});
