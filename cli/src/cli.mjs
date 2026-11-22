import { discoverWorkspace, matchingProfile, summarizeSync } from "./workspace-context.mjs";
import { validateRemoteBody } from "./file-workspace/metadata.mjs";
import { updateMemo } from "./publish.mjs";
import { createNotebook } from "./notebooks.mjs";
import { manageSkills, packageVersion } from "./skills.mjs";
import { interactiveResolve, editDraft } from "./file-workspace/interactive.mjs";
import { resourceTransport } from "./file-workspace/http.mjs";
import { link as linkWorkspace, status as workspaceStatus, sync as syncWorkspace, bindDirectory, gcWorkspace, resolveConflict, conflicts, uploads, retryUpload, migrate, importFile } from "./file-workspace/core.mjs";
import { bootstrapWorkspace } from "./file-workspace/bootstrap.mjs";
import { doctorWorkspace } from "./file-workspace/doctor.mjs";
import { adoptWorkspace } from "./file-workspace/adopt.mjs";
import { trashMemo } from "./file-workspace/trash.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = process.env.EDGEEVER_CONFIG || join(homedir(), ".edgeever", "config.json");
const DEFAULT_URL = "http://127.0.0.1:8787";
const rawArgs = process.argv.slice(2);
const globalOptions = parseOptions(rawArgs);
const commandArgs = stripGlobalOptions(rawArgs, new Set(["profile"]));
const [command, ...argv] = commandArgs;

const usage = `EdgeEver CLI

Usage:
  edgeever --version
  edgeever sync [directory] [--auto-merge] [--pull-only] [--dry-run] [--json]
  edgeever skill install --target codex|claude|kimi|all
  edgeever skill status [--target codex|claude|kimi|all]
  edgeever skill update --target codex|claude|kimi|all [--force]
  edgeever skill install|status|update --dir <skills-directory> [--force]
  edgeever profile set <name> --url <url> --token <token>
  edgeever profile list
  edgeever --profile <name> create-notebook --name <name> [--parent <id>] [--dry-run]
  edgeever --profile <name> create-notebook --path <a/b/c> [--parent <id>] [--parents] [--dry-run] [--retry-uncertain]
  edgeever --profile <name> notebooks
  edgeever --profile <name> tags
  edgeever --profile <name> search <query>
  edgeever --profile <name> get <memoId>
  edgeever --profile <name> create --notebook <id> [--title <title>] [--body <markdown> | --body-file <path>] [--tags a,b]
  edgeever --profile <name> update <memoId> [--title <title>] [--body <markdown> | --body-file <path>] [--tags a,b] [--notebook <id>]
  edgeever --profile <name> move --notebook <id> <memoId...>
  edgeever --profile <name> merge [--notebook <id>] [--title <title>] <memoId...>
  edgeever --profile <name> upload --memo <id> --file <path> [--type <mime>]
  edgeever --profile <name> export <memoId> [--format markdown|json] [--out <path>]

File workspace (server must support /api/v1/file-workspace):
  edgeever workspace link <directory> --notebooks id1,id2 [--exclude id3] [--shallow] [--at <relative-directory>]
  edgeever workspace link <directory> --all [--exclude id3]
  edgeever workspace link <directory> --notebooks id1 --replace-scope
  edgeever workspace migrate <directory> [--dry-run]
  edgeever workspace bind <directory> --notebook <id> --path <relative-directory> [--dry-run]
  edgeever workspace gc <directory> [--dry-run] [--days <30>] [--keep <5>] [--max-bytes <budget>]
  edgeever workspace import <directory> --file <path> --notebook <id> [--title <title>] [--memo <confirmed-id>] [--bind-directory]
  edgeever workspace bootstrap <directory> --include dir1,dir2 [--mapping <json>] [--run]
  edgeever workspace doctor <directory> [--json]
  edgeever workspace adopt <directory> [--run]
  edgeever workspace trash <directory> --memo <id> [--run] [--force]
  edgeever workspace uploads <directory>
  edgeever workspace retry-upload <directory> --key <key>
  edgeever workspace resolve <directory> --memo <id> --use local|remote|merge
  edgeever workspace resolve <directory> --memo <id> --continue
  edgeever workspace resolve <directory> --memo <id> --interactive [--editor <executable>]
  edgeever workspace conflicts <directory>
  edgeever workspace status <directory> [--remote]
  edgeever workspace sync <directory> [--dry-run] [--pull-only] [--auto-merge]

Env fallback:
  EDGEEVER_URL=http://127.0.0.1:8787
  EDGEEVER_TOKEN=...
`;

if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(usage);
  process.exit(0);
}

const main = async () => {
  if (command === "--version" || command === "-v") return console.log(packageVersion);
  if (command === "skill") {
    const result = await manageSkills(argv);
    printJson(result);
    if (result.results.some(item => item.status === "error")) process.exitCode = 1;
    else if (argv[0] !== "status" && result.results.some(item => ["modified", "unmanaged", "blocked", "outdated", "not-installed"].includes(item.status))) process.exitCode = 2;
    return;
  }
  if (command === "profile") {
    return handleProfileCommand(argv);
  }

  if (command === "workspace" && argv[0] === "conflicts") return printJson(await conflicts(argv[1] || "."));
  if (command === "workspace" && argv[0] === "uploads") return printJson(await uploads(argv[1] || "."));
  if (command === "workspace" && argv[0] === "status" && !argv.includes("--remote")) return printJson(await workspaceStatus(argv[1] || "."));
  if (command === "sync") {
    const options=parseOptions(argv);
    const context=await discoverWorkspace(argv[0]&&!argv[0].startsWith('--')?argv[0]:'.');
    const profile=globalOptions.profile || (process.env.EDGEEVER_TOKEN ? undefined : matchingProfile(await readConfig(),context.url));
    const client=await createClient(profile);
    const result=await syncWorkspace(context.directory,client,{dryRun:options['dry-run']==='true',pullOnly:options['pull-only']==='true',autoMerge:options['auto-merge']==='true'});
    const summary=summarizeSync(result);
    if(options.json==='true')printJson({...result,directory:context.directory,summary});
    else {
      const labels={clean:'未变化',pulled:'拉取',pushed:'上传',moved:'移动',untracked:'未跟踪',modified:'本地待上传',conflict:'冲突','directory-removed':'清理空目录','merged-local':'本地合并'};
      console.log(`${result.dryRun?'同步预览':'同步完成'}: ${Object.entries(summary.counts).map(([status,count])=>`${labels[status]||status} ${count}`).join(', ')||'无笔记'}`);
      for(const issue of summary.issues)console.log(`${issue.status}: ${issue.path||issue.notebookId||issue.id||''}${issue.error?' — '+issue.error:''}`);
      if(summary.counts.untracked)console.log('未跟踪文件本次未导入。');
      if(result.gc?.overBudget)console.log('必要备份仍超过空间预算；未强制删除。');
    }
    if(summary.issues.length)process.exitCode=2;
    return;
  }
  if(command==='workspace'&&argv[0]==='gc') {
    const options=parseOptions(argv.slice(2));const opts={dryRun:options['dry-run']==='true'};
    for(const [flag,key] of [['days','days'],['keep','keep'],['max-bytes','maxBytes']])if(options[flag]!==undefined)opts[key]=Number(options[flag]);
    return printJson(await gcWorkspace(argv[1]||'.',opts));
  }
  let profile=globalOptions.profile;
  if(!profile&&!process.env.EDGEEVER_TOKEN&&command==='workspace'&&['sync','bind','migrate','resolve','import','status','doctor','trash'].includes(argv[0])&&argv[1]) {
    const context=await discoverWorkspace(argv[1]);profile=matchingProfile(await readConfig(),context.url);
  }
  const client = await createClient(profile);
  if (command === "workspace") {
    const [action, directory, ...rest] = argv;
    if (!directory || directory.startsWith("--")) throw new Error("A workspace directory is required");
    const options = parseOptions(rest);
    if (action === "link") {
      return printJson(await linkWorkspace(directory, client, {
        all: options.all === "true",
        include: (options.notebooks || "").split(",").filter(Boolean),
        exclude: (options.exclude || "").split(",").filter(Boolean),
        recursive: options.shallow !== "true",
      }, options["replace-scope"] === "true", options.at !== undefined ? options.at : (options.notebooks && !options.notebooks.includes(",") && options["replace-scope"] !== "true" ? "." : undefined)));
    }
    if (action === "status") return printJson(await workspaceStatus(directory, client));
    if (action === "doctor") {
      const result = await doctorWorkspace(directory, client); printJson(result);
      if (!result.ok) process.exitCode = 2;
      return;
    }
    if (action === "adopt") {
      const result = await adoptWorkspace(directory, client, { run: options.run === "true" }); printJson(result);
      if (result.status === 'blocked' || result.conflicts) process.exitCode = 2;
      return;
    }
    if (action === "trash") {
      const result = await trashMemo(directory, client, requireValue(options.memo, "--memo"), { run: options.run === "true", force: options.force === "true" }); printJson(result);
      if (["remote-changed","remote-missing"].includes(result.status)) process.exitCode = 2;
      return;
    }
    if (action === "bootstrap") {
      const include = (options.include || "").split(",").map(value => value.trim()).filter(Boolean);
      const result = await bootstrapWorkspace(directory, client, { include, mappingPath: options.mapping, run: options.run === "true", journalDirectory: join(dirname(CONFIG_PATH), "notebook-operations") }); printJson(result);
      if (result.status === "partial" || result.issues?.length) process.exitCode = 2;
      return;
    }
    if (action === "bind") return printJson(await bindDirectory(directory, client, requireValue(options.notebook,"--notebook"), requireValue(options.path,"--path"), {dryRun:options["dry-run"]==="true"}));
    if (action === "migrate") return printJson(await migrate(directory, client, { dryRun: options["dry-run"] === "true" }));
    if (action === "import") return printJson(await importFile(directory, client, { file: options.file, notebookId: options.notebook, title: options.title, memoId: options.memo, bindDirectory:options["bind-directory"]==="true" }));
    if (action === "retry-upload") return printJson(await retryUpload(directory,client,requireValue(options.key,"--key")));
    if (action === "resolve") {
      const id = requireValue(options.memo, "--memo");
      if ([options.use, options.continue === "true", options.interactive === "true"].filter(Boolean).length !== 1) throw Error("Choose exactly one: --use local|remote|merge, --continue or --interactive");
      if (options.interactive === "true") return printJson(await interactiveResolve(directory, client, id, options.editor));
      if (options.edit === "true" && options.use !== "merge") throw Error("--edit requires --use merge");
      const result = await resolveConflict(directory, client, id, options.continue === "true" ? "continue" : options.use);
      printJson(result);
      if (options.edit === "true") await editDraft(directory, result.draft, options.editor);
      return;
    }
    if (action === "sync") {
      const result = await syncWorkspace(directory, client, { dryRun: options["dry-run"] === "true", pullOnly: options["pull-only"] === "true", autoMerge: options["auto-merge"] === "true" });
      printJson(result);
      if (result.results.some(item => ["unresolved-markers", "conflict", "diagram-read-only", "file-note-unsupported", "path-occupied", "local-changed-during-sync", "missing-local", "attachment-error", "duplicate-id", "unbound-id", "identity-mismatch", "metadata-error"].includes(item.status))) process.exitCode = 2;
      return;
    }
    throw new Error("Unknown workspace command: use link, status, sync, migrate, import, bootstrap, doctor, adopt, trash, resolve, uploads or retry-upload");
  }

  switch (command) {
    case "create-notebook": {
      const options = parseOptions(argv);
      for (const key of ["name", "path", "parent"]) if (options[key] === "true") throw Error(`--${key} requires a value`);
      const result = await createNotebook(client, { name: options.name, path: options.path, parent: options.parent, parents: options.parents === "true", dryRun: options["dry-run"] === "true", retryUncertain: options["retry-uncertain"] === "true" }, join(dirname(CONFIG_PATH), "notebook-operations"));
      printJson(result);
      if (result.status === "failed") process.exitCode = 1;
      if (result.status === "uncertain") process.exitCode = 2;
      return;
    }
    case "notebooks":
      return printJson(await client.request("/api/v1/notebooks"));
    case "tags":
      return printJson(await client.request("/api/v1/tags"));
    case "search": {
      const query = argv.join(" ").trim();
      const params = new URLSearchParams();

      if (query) {
        params.set("q", query);
      }

      return printJson(await client.request(`/api/v1/memos?${params.toString()}`));
    }
    case "get": {
      const memoId = requireValue(argv[0], "memoId");
      return printJson(await client.request(`/api/v1/memos/${encodeURIComponent(memoId)}`));
    }
    case "create": {
      const options = parseOptions(argv);
      const notebookId = requireValue(options.notebook, "--notebook");
      const body = await readBodyOption(options);

      return printJson(
        await client.request("/api/v1/memos", {
          method: "POST",
          body: {
            notebookId,
            title: options.title,
            contentMarkdown: body,
            tags: parseTags(options.tags),
          },
        })
      );
    }
    case "update": {
      const memoId = requireValue(argv[0], "memoId");
      const options = parseOptions(argv.slice(1));
      const body = options.body !== undefined || options["body-file"] !== undefined ? await readBodyOption(options) : undefined;
      const payload = removeUndefined({
        title: options.title,
        notebookId: options.notebook,
        contentMarkdown: body,
        tags: options.tags === undefined ? undefined : parseTags(options.tags),
      });

      return printJson(await updateMemo(client, memoId, payload));
    }
    case "move": {
      const options = parseOptions(argv);
      const memoIds = positionalArgs(argv);

      return printJson(
        await client.request("/api/v1/memos/batch/move", {
          method: "POST",
          body: {
            notebookId: requireValue(options.notebook, "--notebook"),
            memoIds,
          },
        })
      );
    }
    case "merge": {
      const options = parseOptions(argv);
      const memoIds = positionalArgs(argv);

      return printJson(
        await client.request("/api/v1/memos/merge", {
          method: "POST",
          body: removeUndefined({
            notebookId: options.notebook,
            title: options.title,
            memoIds,
          }),
        })
      );
    }
    case "upload": {
      const options = parseOptions(argv);
      const memoId = requireValue(options.memo, "--memo");
      const filePath = requireValue(options.file, "--file");
      return printJson(await client.uploadMemoResource(memoId, filePath, options.type));
    }
    case "export": {
      const memoId = requireValue(argv[0], "memoId");
      const options = parseOptions(argv.slice(1));
      const format = options.format === "json" ? "json" : "markdown";
      const data = await client.request(`/api/v1/memos/${encodeURIComponent(memoId)}`);
      const output = format === "json" ? `${JSON.stringify(data.memo, null, 2)}\n` : data.memo.contentMarkdown;

      if (options.out) {
        await writeFile(options.out, output);
        return;
      }

      process.stdout.write(output);
      return;
    }
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(usage);
      process.exit(1);
  }
};

const createClient = async (profileName) => {
  const config = await readConfig();
  const profile = profileName ? config.profiles?.[profileName] : undefined;
  const baseUrl = (process.env.EDGEEVER_URL || profile?.url || DEFAULT_URL).replace(/\/+$/, "");
  const token = process.env.EDGEEVER_TOKEN || profile?.token;

  if (!token) {
    throw new Error("EDGEEVER_TOKEN is required, or configure a profile with `edgeever profile set`.");
  }

  return {
    baseUrl,
    ...resourceTransport(baseUrl,token),
    request: (path, init = {}) => request(baseUrl, token, path, init),
    uploadMemoResource: (memoId, filePath, mimeType) => uploadMemoResource(baseUrl, token, memoId, filePath, mimeType),
  };
};

const request = async (baseUrl, token, path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body?.error?.message || response.statusText;
    throw Object.assign(new Error(`${response.status} ${message}`), { status: response.status, code: body?.error?.code });
  }

  return body;
};

const uploadMemoResource = async (baseUrl, token, memoId, filePath, mimeType) => {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("file", new File([bytes], basename(filePath), { type: mimeType || inferMimeType(filePath) }));

  const response = await fetch(`${baseUrl}/api/v1/memos/${encodeURIComponent(memoId)}/resources`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body?.error?.message || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  return body;
};

const handleProfileCommand = async (args) => {
  const [subcommand, name, ...rest] = args;

  if (subcommand === "list") {
    const config = await readConfig();
    return printJson({
      profiles: Object.entries(config.profiles || {}).map(([profileName, profile]) => ({
        name: profileName,
        url: profile.url,
        hasToken: Boolean(profile.token),
      })),
    });
  }

  if (subcommand === "set") {
    const profileName = requireValue(name, "profile name");
    const options = parseOptions(rest);
    const config = await readConfig();
    config.profiles = config.profiles || {};
    config.profiles[profileName] = {
      url: requireValue(options.url, "--url").replace(/\/+$/, ""),
      token: requireValue(options.token, "--token"),
    };
    await writeConfig(config);
    return printJson({ ok: true, profile: profileName, path: CONFIG_PATH });
  }

  throw new Error("Unknown profile command.");
};

const readConfig = async () => {
  try {
    const value = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};

const writeConfig = async (config) => {
  await mkdir(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
};

function parseOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];

    if (next === undefined || /^--[a-zA-Z][\w-]*$/.test(next)) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

function positionalArgs(args) {
  const values = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      values.push(arg);
      continue;
    }

    const next = args[index + 1];

    if (next && !next.startsWith("--")) {
      index += 1;
    }
  }

  return values;
}

function stripGlobalOptions(args, globalKeys) {
  const result = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--") || !globalKeys.has(arg.slice(2))) {
      result.push(arg);
      continue;
    }

    if (args[index + 1] && !args[index + 1].startsWith("--")) {
      index += 1;
    }
  }

  return result;
}

const readBodyOption = async (options) => {
  const body = options["body-file"] ? await readFile(options["body-file"], "utf8") : options.body || "";
  validateRemoteBody(body);
  return body;
};

const parseTags = (value) =>
  value
    ? value
        .split(/[,，\s]+/)
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean)
    : [];

const inferMimeType = (filePath) => {
  const normalized = filePath.toLowerCase();

  if (normalized.endsWith(".png")) {
    return "image/png";
  }

  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (normalized.endsWith(".gif")) {
    return "image/gif";
  }

  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }

  if (normalized.endsWith(".avif")) {
    return "image/avif";
  }

  return "application/octet-stream";
};

const removeUndefined = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

const requireValue = (value, name) => {
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
};

const printJson = (value) => {
  console.log(JSON.stringify(value, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
