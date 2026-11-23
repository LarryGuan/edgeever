const DEFAULTS = Object.freeze({
  rootPath: "30_daily",
  notebookPattern: "YYYY/YYYY-MM/YYYY-MM-DD",
  noteTitlePattern: "YYYY-MM-DD",
  weekStartsOn: "monday",
  timezone: "Asia/Shanghai",
});

const copyFor = (locale) => locale.toLocaleLowerCase().startsWith("zh") ? {
  title: "Daily 日历",
  description: "点击日期，打开已有日记；缺失时按规则创建笔记本和笔记。",
  today: "今天",
  previousMonth: "上个月",
  nextMonth: "下个月",
  loading: "正在读取 Daily 笔记…",
  empty: "本月还没有 Daily 内容",
  creating: "正在创建 {date}…",
  opened: "已打开 {date}",
  pathConflict: "路径中存在同一父级下的重名笔记本，请先处理：{name}",
  noteConflict: "当天存在多篇同名笔记，请先处理：{title}",
  createFailed: "无法打开或创建 Daily 笔记：{message}",
  invalidConfig: "Daily 日历配置无效：{message}",
  hasContent: "已有内容",
  noContent: "尚无内容",
  weekdays: ["日", "一", "二", "三", "四", "五", "六"],
} : {
  title: "Daily Calendar",
  description: "Click a date to open its daily note. Missing notebooks and the note are created from your rules.",
  today: "Today",
  previousMonth: "Previous month",
  nextMonth: "Next month",
  loading: "Loading daily notes…",
  empty: "No Daily content this month",
  creating: "Creating {date}…",
  opened: "Opened {date}",
  pathConflict: "Duplicate notebooks exist under the same parent. Resolve them first: {name}",
  noteConflict: "Multiple notes have the same daily title. Resolve them first: {title}",
  createFailed: "Could not open or create the daily note: {message}",
  invalidConfig: "Daily Calendar settings are invalid: {message}",
  hasContent: "Has content",
  noContent: "No content yet",
  weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

const interpolate = (template, values) => Object.entries(values).reduce(
  (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
  template,
);

const hasControlCharacters = (value) => [...value].some((character) => character.codePointAt(0) < 32);

export const dateParts = (year, month, day) => ({
  YYYY: String(year).padStart(4, "0"),
  MM: String(month).padStart(2, "0"),
  DD: String(day).padStart(2, "0"),
});

export const formatDatePattern = (pattern, parts) => pattern
  .replaceAll("YYYY", parts.YYYY)
  .replaceAll("MM", parts.MM)
  .replaceAll("DD", parts.DD);

export const splitNotebookPath = (value) => {
  const segments = String(value ?? "").split("/").map((segment) => segment.trim());
  if (!segments.length || segments.some((segment) => !segment)) throw new Error("Notebook paths cannot contain empty levels.");
  for (const segment of segments) {
    if (segment === "." || segment === "..") throw new Error("Notebook paths cannot use . or .. levels.");
    if (segment.length > 120 || hasControlCharacters(segment)) throw new Error("A generated notebook name is invalid.");
  }
  return segments;
};

export const buildDatePath = (config, parts) => [
  ...splitNotebookPath(config.rootPath),
  ...splitNotebookPath(formatDatePattern(config.notebookPattern, parts)),
];

export const resolveExistingPath = (notebooks, segments) => {
  let parentId = null;
  let leaf = null;
  for (const name of segments) {
    const matches = notebooks.filter((notebook) => notebook.parentId === parentId && notebook.name === name);
    if (matches.length > 1) return { status: "conflict", name, notebook: null };
    if (matches.length === 0) return { status: "missing", name, notebook: null };
    leaf = matches[0];
    parentId = leaf.id;
  }
  return { status: "found", name: segments.at(-1) ?? "", notebook: leaf };
};

export const buildCalendarCells = (year, month, weekStartsOn = "monday") => {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const weekStart = weekStartsOn === "sunday" ? 0 : 1;
  const leading = (firstWeekday - weekStart + 7) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, index - leading + 1));
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() + 1 === month,
    };
  });
};

const readTextSetting = async (context, key, fallback) => {
  const value = await context.settings.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

export const readConfig = async (context) => {
  const [rootPath, notebookPattern, noteTitlePattern, weekStartsOn, timezone] = await Promise.all([
    readTextSetting(context, "rootPath", DEFAULTS.rootPath),
    readTextSetting(context, "notebookPattern", DEFAULTS.notebookPattern),
    readTextSetting(context, "noteTitlePattern", DEFAULTS.noteTitlePattern),
    readTextSetting(context, "weekStartsOn", DEFAULTS.weekStartsOn),
    readTextSetting(context, "timezone", DEFAULTS.timezone),
  ]);
  if (!notebookPattern.includes("YYYY") || !notebookPattern.includes("MM") || !notebookPattern.includes("DD")) {
    throw new Error("The notebook pattern must include YYYY, MM and DD.");
  }
  if (!noteTitlePattern.includes("YYYY") || !noteTitlePattern.includes("MM") || !noteTitlePattern.includes("DD")) {
    throw new Error("The note title pattern must include YYYY, MM and DD.");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Unknown time zone: ${timezone}`);
  }
  const probe = dateParts(2026, 11, 23);
  buildDatePath({ rootPath, notebookPattern }, probe);
  const title = formatDatePattern(noteTitlePattern, probe).trim();
  if (!title || title.length > 500 || hasControlCharacters(title)) throw new Error("The generated note title is invalid.");
  return {
    rootPath,
    notebookPattern,
    noteTitlePattern,
    weekStartsOn: weekStartsOn === "sunday" ? "sunday" : "monday",
    timezone,
  };
};

const todayInTimezone = (timezone) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day) };
};

const dateKey = ({ year, month, day }) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export const ensureNotebookPath = async (context, segments) => {
  let parentId = null;
  for (const name of segments) {
    let notebooks = await context.notebooks.list();
    let matches = notebooks.filter((notebook) => notebook.parentId === parentId && notebook.name === name);
    if (matches.length > 1) return { status: "conflict", name, notebook: null };
    if (matches.length === 0) {
      await context.notebooks.create({ name, parentId });
      notebooks = await context.notebooks.list();
      matches = notebooks.filter((notebook) => notebook.parentId === parentId && notebook.name === name);
      if (matches.length > 1) return { status: "conflict", name, notebook: null };
      if (matches.length === 0) throw new Error(`Notebook was not found after creation: ${name}`);
    }
    parentId = matches[0].id;
  }
  const notebooks = await context.notebooks.list();
  return { status: "found", name: segments.at(-1) ?? "", notebook: notebooks.find((item) => item.id === parentId) ?? null };
};

const findExactNotes = async (context, notebookId, title) => {
  const exact = [];
  let offset = 0;
  while (offset !== null) {
    const result = await context.notes.query({ notebookId, text: title, sort: "title-asc", limit: 200, offset });
    exact.push(...result.notes.filter((note) => note.title === title));
    offset = result.nextOffset;
  }
  return exact;
};

const monthLabel = (locale, year, month) => new Intl.DateTimeFormat(locale, {
  year: "numeric",
  month: "long",
  timeZone: "UTC",
}).format(new Date(Date.UTC(year, month - 1, 1)));

const createButton = (className, label, text) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.textContent = text;
  return button;
};

export default {
  activate(context) {
    const locale = document.documentElement.lang || navigator.language || "en";
    const copy = copyFor(locale);
    const disposePanel = context.ui.panels.register({
      id: "daily-calendar",
      title: copy.title,
      purpose: "dashboard",
      presentation: "sidebar",
      async mount(container, { shell }) {
        shell.set({ header: { title: copy.title, description: copy.description } });

        const root = document.createElement("div");
        root.className = "edgeever-daily-calendar";
        const controls = document.createElement("div");
        controls.className = "edgeever-daily-calendar__controls";
        const previous = createButton("edgeever-daily-calendar__nav", copy.previousMonth, "‹");
        const heading = document.createElement("div");
        heading.className = "edgeever-daily-calendar__heading";
        const todayButton = createButton("edgeever-daily-calendar__today", copy.today, copy.today);
        const next = createButton("edgeever-daily-calendar__nav", copy.nextMonth, "›");
        controls.append(previous, heading, todayButton, next);

        const weekdays = document.createElement("div");
        weekdays.className = "edgeever-daily-calendar__weekdays";
        const grid = document.createElement("div");
        grid.className = "edgeever-daily-calendar__grid";
        grid.setAttribute("role", "grid");
        const status = document.createElement("p");
        status.className = "edgeever-daily-calendar__status";
        root.append(controls, weekdays, grid, status);
        container.append(root);

        let config;
        let cursor;
        let selectedKey = null;
        let busyKey = null;
        let disposed = false;
        let renderToken = 0;
        let refreshTimer = null;

        const setStatus = (message, tone = "neutral") => {
          status.textContent = message;
          status.dataset.tone = tone;
        };

        const renderWeekdays = () => {
          weekdays.replaceChildren();
          const names = config.weekStartsOn === "sunday" ? copy.weekdays : [...copy.weekdays.slice(1), copy.weekdays[0]];
          for (const name of names) {
            const item = document.createElement("span");
            item.textContent = name;
            weekdays.append(item);
          }
        };

        const scheduleRefresh = () => {
          if (refreshTimer) window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(() => { void renderMonth(); }, 120);
        };

        const openDate = async (cell) => {
          const key = dateKey(cell);
          if (busyKey) return;
          busyKey = key;
          selectedKey = key;
          setStatus(interpolate(copy.creating, { date: key }));
          await renderMonth();
          try {
            const parts = dateParts(cell.year, cell.month, cell.day);
            const path = buildDatePath(config, parts);
            const resolved = await ensureNotebookPath(context, path);
            if (resolved.status === "conflict" || !resolved.notebook) {
              const message = interpolate(copy.pathConflict, { name: resolved.name });
              context.ui.showNotice(message);
              setStatus(message, "error");
              return;
            }
            const title = formatDatePattern(config.noteTitlePattern, parts).trim();
            const exact = await findExactNotes(context, resolved.notebook.id, title);
            if (exact.length > 1) {
              const message = interpolate(copy.noteConflict, { title });
              context.ui.showNotice(message);
              setStatus(message, "error");
              return;
            }
            const note = exact[0] ?? await context.notes.create({
              notebookId: resolved.notebook.id,
              title,
              contentMarkdown: "",
            });
            await context.ui.openNote(note.id);
            setStatus(interpolate(copy.opened, { date: key }), "success");
          } catch (error) {
            const message = interpolate(copy.createFailed, { message: error instanceof Error ? error.message : String(error) });
            context.ui.showNotice(message);
            setStatus(message, "error");
          } finally {
            busyKey = null;
            await renderMonth();
          }
        };

        async function renderMonth() {
          const token = ++renderToken;
          heading.textContent = monthLabel(locale, cursor.year, cursor.month);
          grid.setAttribute("aria-busy", "true");
          if (!busyKey) setStatus(copy.loading);
          try {
            const notebooks = await context.notebooks.list();
            if (disposed || token !== renderToken) return;
            const today = todayInTimezone(config.timezone);
            const cells = buildCalendarCells(cursor.year, cursor.month, config.weekStartsOn);
            let activeCount = 0;
            const fragment = document.createDocumentFragment();
            for (const cell of cells) {
              const key = dateKey(cell);
              const resolved = resolveExistingPath(notebooks, buildDatePath(config, dateParts(cell.year, cell.month, cell.day)));
              const hasContent = resolved.status === "found" && Boolean(resolved.notebook?.memoCount);
              if (cell.inMonth && hasContent) activeCount += 1;
              const button = createButton(
                "edgeever-daily-calendar__day",
                `${key} · ${hasContent ? copy.hasContent : copy.noContent}`,
                String(cell.day),
              );
              button.dataset.outside = cell.inMonth ? "false" : "true";
              button.dataset.today = dateKey(today) === key ? "true" : "false";
              button.dataset.selected = selectedKey === key ? "true" : "false";
              button.dataset.busy = busyKey === key ? "true" : "false";
              if (hasContent) {
                const dot = document.createElement("span");
                dot.className = "edgeever-daily-calendar__dot";
                dot.setAttribute("aria-hidden", "true");
                button.append(dot);
              }
              button.disabled = Boolean(busyKey);
              button.addEventListener("click", () => void openDate(cell));
              fragment.append(button);
            }
            grid.replaceChildren(fragment);
            if (!busyKey) setStatus(activeCount ? "" : copy.empty);
          } catch (error) {
            if (disposed || token !== renderToken) return;
            const message = interpolate(copy.invalidConfig, { message: error instanceof Error ? error.message : String(error) });
            setStatus(message, "error");
          } finally {
            if (!disposed && token === renderToken) grid.setAttribute("aria-busy", "false");
          }
        }

        try {
          config = await readConfig(context);
          const today = todayInTimezone(config.timezone);
          cursor = { year: today.year, month: today.month };
          renderWeekdays();
          await renderMonth();
        } catch (error) {
          const message = interpolate(copy.invalidConfig, { message: error instanceof Error ? error.message : String(error) });
          setStatus(message, "error");
          context.ui.showNotice(message);
          return () => root.remove();
        }

        previous.addEventListener("click", () => {
          const date = new Date(Date.UTC(cursor.year, cursor.month - 2, 1));
          cursor = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
          void renderMonth();
        });
        next.addEventListener("click", () => {
          const date = new Date(Date.UTC(cursor.year, cursor.month, 1));
          cursor = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
          void renderMonth();
        });
        todayButton.addEventListener("click", () => {
          const today = todayInTimezone(config.timezone);
          cursor = { year: today.year, month: today.month };
          selectedKey = dateKey(today);
          void renderMonth();
        });

        const disposers = [
          context.events.on("note.created", scheduleRefresh),
          context.events.on("note.updated", scheduleRefresh),
          context.events.on("note.deleted", scheduleRefresh),
          context.events.on("workspace.synced", scheduleRefresh),
          context.events.on("settings.changed", async () => {
            try {
              config = await readConfig(context);
              renderWeekdays();
              scheduleRefresh();
            } catch (error) {
              setStatus(interpolate(copy.invalidConfig, { message: error instanceof Error ? error.message : String(error) }), "error");
            }
          }),
        ];

        return () => {
          disposed = true;
          if (refreshTimer) window.clearTimeout(refreshTimer);
          for (const dispose of disposers) dispose();
          root.remove();
        };
      },
    });
    return () => disposePanel();
  },
};
