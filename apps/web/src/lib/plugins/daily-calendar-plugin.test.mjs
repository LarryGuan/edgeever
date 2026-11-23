import { describe, expect, test } from "bun:test";
import {
  buildCalendarCells,
  buildDatePath,
  dateParts,
  ensureNotebookPath,
  formatDatePattern,
  resolveExistingPath,
  splitNotebookPath,
} from "../../../public/extensions/daily-calendar/main.js";

describe("Daily Calendar plugin", () => {
  test("expands the standard MySystem daily path", () => {
    const parts = dateParts(2026, 11, 23);
    expect(formatDatePattern("YYYY-MM-DD", parts)).toBe("2026-11-23");
    expect(buildDatePath({
      rootPath: "30_daily",
      notebookPattern: "YYYY/YYYY-MM/YYYY-MM-DD",
    }, parts)).toEqual(["30_daily", "2026", "2026-11", "2026-11-23"]);
  });

  test("rejects ambiguous and unsafe path segments", () => {
    expect(() => splitNotebookPath("30_daily//2026")).toThrow("empty levels");
    expect(() => splitNotebookPath("30_daily/../2026")).toThrow("cannot use");
  });

  test("builds a Monday-first six-week calendar", () => {
    const cells = buildCalendarCells(2026, 11, "monday");
    expect(cells).toHaveLength(42);
    expect(cells[0]).toMatchObject({ year: 2026, month: 10, day: 26, inMonth: false });
    expect(cells[7]).toMatchObject({ year: 2026, month: 11, day: 2, inMonth: true });
  });

  test("resolves notebook paths only within the exact parent", () => {
    const notebooks = [
      { id: "root", parentId: null, name: "30_daily", memoCount: 0 },
      { id: "year", parentId: "root", name: "2026", memoCount: 0 },
      { id: "wrong-year", parentId: null, name: "2026", memoCount: 0 },
    ];
    expect(resolveExistingPath(notebooks, ["30_daily", "2026"])).toMatchObject({
      status: "found",
      notebook: { id: "year" },
    });
  });

  test("creates only missing notebook levels and returns the leaf", async () => {
    const notebooks = [{ id: "root", parentId: null, name: "30_daily", memoCount: 0 }];
    let nextId = 1;
    const created = [];
    const context = {
      notebooks: {
        list: async () => notebooks.map((item) => ({ ...item })),
        create: async ({ name, parentId }) => {
          const notebook = { id: `new-${nextId++}`, parentId, name, memoCount: 0 };
          notebooks.push(notebook);
          created.push({ name, parentId });
          return notebook;
        },
      },
    };

    const result = await ensureNotebookPath(context, ["30_daily", "2026", "2026-11"]);
    expect(created).toEqual([
      { name: "2026", parentId: "root" },
      { name: "2026-11", parentId: "new-1" },
    ]);
    expect(result).toMatchObject({ status: "found", notebook: { id: "new-2" } });
  });

  test("stops when siblings have duplicate names", async () => {
    const context = {
      notebooks: {
        list: async () => [
          { id: "a", parentId: null, name: "30_daily", memoCount: 0 },
          { id: "b", parentId: null, name: "30_daily", memoCount: 0 },
        ],
        create: async () => { throw new Error("must not create"); },
      },
    };
    await expect(ensureNotebookPath(context, ["30_daily"])).resolves.toMatchObject({
      status: "conflict",
      name: "30_daily",
    });
  });
});
