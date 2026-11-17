#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

DRY_RUN=1
BUILD_ONLY=0
MODE_ARG=""
RESUME_RUN_ID=""

YUNXIAO_ENV_FILE="${YUNXIAO_ENV_FILE:-$HOME/.config/aliyun-devops/env.sh}"
YUNXIAO_API_BASE="${YUNXIAO_API_BASE:-https://openapi-rdc.aliyuncs.com}"
YUNXIAO_PIPELINE_ID="${YUNXIAO_PIPELINE_ID:-5282954}"
YUNXIAO_DEPLOY_JOB_SIGN="${YUNXIAO_DEPLOY_JOB_SIGN:-deploy-deploy_edgeever}"
YUNXIAO_BUILD_JOB_SIGN="${YUNXIAO_BUILD_JOB_SIGN:-build-build_edgeever}"
YUNXIAO_POLL_SECONDS="${YUNXIAO_POLL_SECONDS:-10}"
YUNXIAO_TIMEOUT_SECONDS="${YUNXIAO_TIMEOUT_SECONDS:-5400}"
GIT_SYNC_TIMEOUT_SECONDS="${GIT_SYNC_TIMEOUT_SECONDS:-120}"
EDGEEVER_HEALTH_URL="${EDGEEVER_HEALTH_URL:-https://115.191.43.203:8788/api/health}"
EXPECTED_ORIGIN_PATTERN='github\.com[:/]LarryGuan/edgeever(\.git)?$'

TEMP_DIR=""
LOCK_DIR=""
NEW_CLI_PACKAGE=""
CLI_PREFIX=""
CLI_NPM=""
CLI_BIN=""
CLI_BACKUP=""

usage() {
  cat <<'EOF'
用法：./auto/update.sh [--dry-run | --build-only | --run | --resume-run ID]

发布 GitHub main 到云效，并在发布成功后更新本机 EdgeEver CLI 和 Claude Code Skill。

选项：
  --dry-run   只检查配置并展示将执行的操作；这是默认模式
  --build-only  同步代码、测试 CLI 并构建镜像；停在人工部署门禁，不修改服务器或本机 CLI/Skill
  --run       正式同步、部署并更新 CLI 和 Skill
  --resume-run ID  恢复已有的云效运行，不创建新流水线
  -h, --help  显示帮助

可覆盖的环境变量：
  YUNXIAO_ENV_FILE            云效令牌环境文件
  YUNXIAO_API_BASE            云效中心版 API 地址
  YUNXIAO_PIPELINE_ID         流水线 ID
  YUNXIAO_POLL_SECONDS        轮询间隔，默认 10 秒
  YUNXIAO_TIMEOUT_SECONDS     总超时，默认 5400 秒
  GIT_SYNC_TIMEOUT_SECONDS    Git 同步硬超时，默认 120 秒
  EDGEEVER_HEALTH_URL         部署后的健康检查地址
EOF
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
  if [[ -n "$LOCK_DIR" && -d "$LOCK_DIR" ]]; then
    rm -rf -- "$LOCK_DIR"
  fi
  exit "$status"
}

parse_args() {
  while (($#)); do
    case "$1" in
      --dry-run)
        [[ -z "$MODE_ARG" || "$MODE_ARG" == "dry-run" ]] || die "--dry-run 不能与其他运行模式同时使用"
        MODE_ARG="dry-run"
        DRY_RUN=1
        ;;
      --run)
        [[ -z "$MODE_ARG" || "$MODE_ARG" == "run" ]] || die "--run 不能与其他运行模式同时使用"
        MODE_ARG="run"
        DRY_RUN=0
        ;;
      --build-only)
        [[ -z "$MODE_ARG" || "$MODE_ARG" == "build-only" ]] || die "--build-only 不能与其他运行模式同时使用"
        MODE_ARG="build-only"
        BUILD_ONLY=1
        DRY_RUN=0
        ;;
      --resume-run)
        [[ -z "$MODE_ARG" ]] || die "--resume-run 不能与其他运行模式同时使用"
        [[ $# -ge 2 ]] || die "--resume-run 后需要云效运行 ID"
        [[ "$2" =~ ^[0-9]+$ ]] || die "云效运行 ID 必须是整数"
        MODE_ARG="resume"
        RESUME_RUN_ID="$2"
        DRY_RUN=0
        shift
        ;;
      -h|--help) usage; exit 0 ;;
      *) die "未知参数：$1" ;;
    esac
    shift
  done
}

acquire_lock() {
  local lock_root="${TMPDIR:-/tmp}"
  LOCK_DIR="${lock_root%/}/edgeever-release.lock"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    die "已有更新任务在运行，或遗留了锁目录：$LOCK_DIR"
  fi
}

load_yunxiao_credentials() {
  [[ -r "$YUNXIAO_ENV_FILE" ]] || die "无法读取云效配置：$YUNXIAO_ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$YUNXIAO_ENV_FILE"
  set +a
  : "${ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN:?云效配置缺少 ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN}"
  : "${ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID:?云效配置缺少 ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID}"
}

resolve_cli_installation() {
  local current_cli
  current_cli="$(command -v edgeever || true)"
  [[ -n "$current_cli" ]] || die "没有找到已安装的 edgeever CLI"

  CLI_PREFIX="$(realpath "$(dirname "$current_cli")/..")"
  CLI_NPM="$CLI_PREFIX/bin/npm"
  CLI_BIN="$CLI_PREFIX/bin/edgeever"
  [[ -x "$CLI_NPM" ]] || die "CLI 安装目录中没有 npm：$CLI_NPM"
  [[ -x "$CLI_BIN" ]] || die "CLI 安装目录中没有 edgeever：$CLI_BIN"
  export PATH="$CLI_PREFIX/bin:$PATH"

  local node_major
  node_major="$("$CLI_PREFIX/bin/node" --version | sed -E 's/^v([0-9]+).*/\1/')"
  [[ "$node_major" =~ ^[0-9]+$ ]] || die "无法识别 Node.js 版本"
  ((node_major >= 22)) || die "EdgeEver CLI 需要 Node.js 22 或更高版本"
}

remote_main_sha() {
  curl --silent --show-error --fail \
    --connect-timeout 5 --max-time 15 \
    --header 'Accept: application/vnd.github+json' \
    --header 'User-Agent: edgeever-auto-update' \
    'https://api.github.com/repos/LarryGuan/edgeever/commits/main' \
    | python3 -c 'import json, sys; print(json.load(sys.stdin)["sha"])' \
    || die "15 秒内无法读取 GitHub main；请检查网络后重试"
}

run_with_timeout() {
  local seconds=$1
  shift
  python3 - "$seconds" "$@" <<'PY'
import os
import signal
import subprocess
import sys

timeout = int(sys.argv[1])
command = sys.argv[2:]
process = subprocess.Popen(command, start_new_session=True)

def stop_process():
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()

try:
    result = process.wait(timeout=timeout)
except subprocess.TimeoutExpired:
    stop_process()
    print(f"命令执行超过 {timeout} 秒，已停止", file=sys.stderr)
    raise SystemExit(124)
except KeyboardInterrupt:
    stop_process()
    raise SystemExit(130)
raise SystemExit(result)
PY
}

sync_repository() {
  local branch origin_url head_sha remote_sha
  branch="$(git -C "$REPO_ROOT" branch --show-current)"
  [[ "$branch" == "main" ]] || die "当前分支是 ${branch}；只允许从 main 发布"

  origin_url="$(git -C "$REPO_ROOT" remote get-url origin)"
  [[ "$origin_url" =~ $EXPECTED_ORIGIN_PATTERN ]] || die "origin 不是 LarryGuan/edgeever：$origin_url"

  git -C "$REPO_ROOT" diff --quiet || die "存在未提交的受跟踪文件，请先提交或还原"
  git -C "$REPO_ROOT" diff --cached --quiet || die "暂存区存在未提交修改，请先提交"

  head_sha="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  log "检查 GitHub main"
  remote_sha="$(remote_main_sha)"

  if [[ "$head_sha" != "$remote_sha" ]]; then
    if ((DRY_RUN)); then
      log "本地需要同步；正式运行时会自动执行安全的 fast-forward 更新"
      return 0
    fi

    log "自动同步 GitHub main"
    if ! run_with_timeout "$GIT_SYNC_TIMEOUT_SECONDS" env GIT_TERMINAL_PROMPT=0 git \
      -c http.version=HTTP/1.1 \
      -c credential.helper= \
      -c http.lowSpeedLimit=1 \
      -c http.lowSpeedTime=30 \
      -C "$REPO_ROOT" pull --ff-only origin main; then
      die "Git 自动同步失败；请检查网络、本地改动或分支是否分叉。云效尚未触发"
    fi

    head_sha="$(git -C "$REPO_ROOT" rev-parse HEAD)"
    remote_sha="$(remote_main_sha)"
    [[ "$head_sha" == "$remote_sha" ]] \
      || die "Git 同步后仍与 GitHub main 不一致。云效尚未触发"
  fi
  log "待发布提交：$head_sha"
}

prepare_local_update() {
  local installed_package backup_root backup_name
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/edgeever-release.XXXXXX")"
  export NPM_CONFIG_CACHE="$TEMP_DIR/npm-cache"

  log "安装 CLI 构建依赖"
  "$CLI_NPM" ci --prefix "$REPO_ROOT/cli"
  log "运行 CLI 测试"
  "$CLI_NPM" test --prefix "$REPO_ROOT/cli"
  log "打包待安装 CLI"
  NEW_CLI_PACKAGE="$TEMP_DIR/$("$CLI_NPM" pack "$REPO_ROOT/cli" --pack-destination "$TEMP_DIR" --silent | tail -n 1)"
  [[ -f "$NEW_CLI_PACKAGE" ]] || die "CLI 安装包生成失败"

  installed_package="$CLI_PREFIX/lib/node_modules/knowledge-workbench-edgeever-cli"
  if (( ! BUILD_ONLY )) && [[ -d "$installed_package" ]]; then
    backup_root="${XDG_STATE_HOME:-$HOME/.local/state}/edgeever/automation-backups/$(date '+%Y%m%dT%H%M%S')"
    mkdir -p "$backup_root"
    backup_name="$("$CLI_NPM" pack "$installed_package" --pack-destination "$backup_root" --silent | tail -n 1)"
    CLI_BACKUP="$backup_root/$backup_name"
    [[ -f "$CLI_BACKUP" ]] || die "当前 CLI 备份失败"
    log "当前 CLI 已备份：$CLI_BACKUP"
  fi
}

api_request() {
  local method=$1 url=$2 output=$3 data=${4-}
  local header_file="$TEMP_DIR/yunxiao-headers"
  if [[ ! -f "$header_file" ]]; then
    (umask 077; printf 'Content-Type: application/json\nx-yunxiao-token: %s\n' \
      "$ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN" >"$header_file")
  fi
  local args=(
    --silent --show-error --fail-with-body
    --connect-timeout 10 --max-time 30
    --request "$method"
    --header "@$header_file"
    --output "$output"
  )
  if [[ -n "$data" ]]; then
    args+=(--data "$data")
  fi
  curl "${args[@]}" "$url"
}

create_pipeline_run() {
  local base_url body response run_id
  base_url="$YUNXIAO_API_BASE/oapi/v1/flow/organizations/$ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID/pipelines/$YUNXIAO_PIPELINE_ID"
  body="$(python3 - <<'PY'
import json
params = {
    "runningBranchs": {"https://github.com/LarryGuan/edgeever.git": "main"},
    "comment": "auto/update.sh",
}
print(json.dumps({"params": json.dumps(params, ensure_ascii=False)}, ensure_ascii=False))
PY
)"
  response="$TEMP_DIR/create-run.json"
  api_request POST "$base_url/runs" "$response" "$body"
  run_id="$(python3 - "$response" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as file:
    data = json.load(file)
if isinstance(data, int):
    print(data)
elif isinstance(data, dict) and data.get("pipelineRunId") is not None:
    print(data["pipelineRunId"])
else:
    raise SystemExit(f"无法从响应中取得 pipelineRunId: {data!r}")
PY
)"
  [[ "$run_id" =~ ^[0-9]+$ ]] || die "云效返回了无效的运行 ID"
  printf '%s\n' "$run_id"
}

read_run_state() {
  local response=$1
  python3 - "$response" "$YUNXIAO_BUILD_JOB_SIGN" "$YUNXIAO_DEPLOY_JOB_SIGN" <<'PY'
import json, sys
path, build_sign, deploy_sign = sys.argv[1:]
with open(path, encoding="utf-8") as file:
    data = json.load(file)
jobs = []
for stage in data.get("stages") or []:
    info = stage.get("stageInfo") or {}
    jobs.extend(info.get("jobs") or stage.get("jobs") or [])
def find(sign):
    return next((job for job in jobs if job.get("jobSign") == sign), {})
build = find(build_sign)
deploy = find(deploy_sign)
image = ""
result = build.get("result")
if isinstance(result, str):
    try:
        result = json.loads(result)
    except json.JSONDecodeError:
        result = {}
if isinstance(result, dict):
    result_data = result.get("data") or {}
    preferred_keys = (
        "build-build_edgeever-build_image.dynamic_output.edgeever_image",
        "build-build_edgeever-build_image.DOCKER_OUTPUT",
        "build-build_edgeever-build_image.DOCKER_TAG",
    )
    for key in preferred_keys:
        artifact = result_data.get(key)
        if not artifact:
            continue
        if isinstance(artifact, str):
            try:
                artifact = json.loads(artifact)
            except json.JSONDecodeError:
                artifact = {}
        if isinstance(artifact, dict):
            image = artifact.get("dockerUrl") or artifact.get("DOCKER_URL") or ""
        if image:
            break
values = [
    data.get("status") or "UNKNOWN",
    build.get("status") or "MISSING",
    deploy.get("status") or "MISSING",
    str(deploy.get("id") or ""),
    image,
]
print("\t".join(values))
PY
}

wait_for_pipeline() {
  local run_id=$1 base_url response state pipeline_status build_status deploy_status deploy_job_id image
  local started_at now deploy_started=0
  base_url="$YUNXIAO_API_BASE/oapi/v1/flow/organizations/$ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID/pipelines/$YUNXIAO_PIPELINE_ID"
  response="$TEMP_DIR/run-state.json"
  started_at=$(date +%s)

  while true; do
    now=$(date +%s)
    ((now - started_at <= YUNXIAO_TIMEOUT_SECONDS)) \
      || die "等待云效流水线超时（${YUNXIAO_TIMEOUT_SECONDS} 秒）"

    api_request GET "$base_url/runs/$run_id" "$response"
    state="$(read_run_state "$response")"
    IFS=$'\t' read -r pipeline_status build_status deploy_status deploy_job_id image <<<"$state"
    log "云效 #${run_id}：pipeline=$pipeline_status build=$build_status deploy=$deploy_status"

    case "$pipeline_status" in
      FAIL|FAILED|CANCEL|CANCELED|CANCELLED|STOP|STOPPED) die "云效流水线 #$run_id 未成功：$pipeline_status" ;;
    esac
    case "$build_status" in
      FAIL|FAILED|CANCEL|CANCELED|CANCELLED|STOP|STOPPED) die "镜像构建未成功：$build_status" ;;
    esac
    case "$deploy_status" in
      FAIL|FAILED|CANCEL|CANCELED|CANCELLED|STOP|STOPPED) die "服务器部署未成功：$deploy_status" ;;
    esac

    if ((BUILD_ONLY)) && [[ "$build_status" == "SUCCESS" ]]; then
      case "$deploy_status" in
        RUNNING|SUCCESS)
          die "只构建模式检测到部署任务已启动（${deploy_status}）；请立即核查云效运行 #${run_id}"
          ;;
      esac
      if [[ "$deploy_status" == "SWITCH_MANUAL" ]]; then
        [[ -n "$image" ]] || die "镜像已构建，但未能从云效结果中读取 ACR 镜像地址"
        log "构建完成，部署门禁保持为：$deploy_status"
        printf 'pipelineRunId=%s\n' "$run_id"
        printf 'image=%s\n' "$image"
        printf 'deploy=%s\n' "$deploy_status"
        printf 'next=./auto/update.sh --resume-run %s\n' "$run_id"
        return 0
      fi
    fi

    if [[ "$build_status" == "SUCCESS" && "$deploy_status" == "SUCCESS" && "$pipeline_status" == "SUCCESS" ]]; then
      return 0
    fi

    if [[ "$build_status" == "SUCCESS" && "$deploy_status" != "RUNNING" && "$deploy_status" != "SUCCESS" && $deploy_started -eq 0 ]]; then
      [[ "$deploy_job_id" =~ ^[0-9]+$ ]] || die "构建已完成，但找不到手动部署任务 ID"
      log "启动手动部署任务：$YUNXIAO_DEPLOY_JOB_SIGN"
      api_request POST "$base_url/pipelineRuns/$run_id/jobs/$deploy_job_id/start" "$TEMP_DIR/start-job.json"
      python3 - "$TEMP_DIR/start-job.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as file:
    data = json.load(file)
if data is not True:
    raise SystemExit(f"云效没有接受手动部署请求: {data!r}")
PY
      deploy_started=1
    fi

    sleep "$YUNXIAO_POLL_SECONDS"
  done
}

verify_service() {
  log "检查线上健康状态：$EDGEEVER_HEALTH_URL"
  curl --silent --show-error --fail --connect-timeout 10 --max-time 30 \
    --retry 4 --retry-delay 3 --retry-all-errors "$EDGEEVER_HEALTH_URL" >/dev/null
}

install_cli_and_skill() {
  local expected_version actual_version skill_link expected_link
  expected_version="$(python3 - "$REPO_ROOT/cli/package.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as file:
    print(json.load(file)["version"])
PY
)"

  log "安装 EdgeEver CLI $expected_version"
  "$CLI_NPM" install --global --prefix "$CLI_PREFIX" "$NEW_CLI_PACKAGE"
  actual_version="$("$CLI_BIN" --version)"
  [[ "$actual_version" == "$expected_version" ]] \
    || die "CLI 版本校验失败：期望 ${expected_version}，实际 $actual_version"

  skill_link="$HOME/.agents/skills/edgeever"
  expected_link="$HOME/.claude/skills/edgeever"
  [[ -L "$skill_link" && "$(readlink "$skill_link")" == "$expected_link" ]] \
    || die "Skill 软链接不符合预期：$skill_link 应指向 $expected_link"

  log "更新 Claude Code 的 EdgeEver Skill"
  "$CLI_BIN" skill update --target claude
  "$CLI_BIN" skill status --target claude
  [[ -L "$skill_link" && "$(readlink "$skill_link")" == "$expected_link" ]] \
    || die "Skill 更新后软链接发生变化，请检查 $skill_link"

  log "CLI 与 Skill 更新完成"
  if [[ -n "$CLI_BACKUP" ]]; then
    log "CLI 回滚包：$CLI_BACKUP"
    log "需要回滚时执行：$CLI_NPM install --global --prefix $CLI_PREFIX $CLI_BACKUP"
  fi
}

main() {
  parse_args "$@"
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' HUP TERM

  if ((DRY_RUN)); then
    log "模式：检查模式（不会同步代码、触发云效或修改 CLI/Skill）"
  elif ((BUILD_ONLY)); then
    log "模式：只构建（会同步代码、测试 CLI 并构建镜像；不会部署生产或修改本机 CLI/Skill）"
  elif [[ -n "$RESUME_RUN_ID" ]]; then
    log "模式：恢复部署（将放行指定云效运行，并在成功后更新本机 CLI/Skill）"
  else
    log "模式：正式执行（将同步代码、部署云效并更新 CLI/Skill）"
  fi

  require_command git
  require_command curl
  require_command python3
  require_command realpath
  [[ "$YUNXIAO_PIPELINE_ID" =~ ^[0-9]+$ ]] || die "YUNXIAO_PIPELINE_ID 必须是整数"
  [[ "$YUNXIAO_POLL_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "YUNXIAO_POLL_SECONDS 必须是正整数"
  [[ "$YUNXIAO_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "YUNXIAO_TIMEOUT_SECONDS 必须是正整数"
  [[ "$GIT_SYNC_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "GIT_SYNC_TIMEOUT_SECONDS 必须是正整数"
  resolve_cli_installation
  load_yunxiao_credentials
  sync_repository

  if ((DRY_RUN)); then
    log "演练通过；首次跨版本升级请使用：./auto/update.sh --build-only"
    log "只构建将依次：测试并打包 CLI、运行云效镜像构建、停在人工部署门禁并输出恢复命令。"
    exit 0
  fi

  acquire_lock
  prepare_local_update

  local run_id
  if [[ -n "$RESUME_RUN_ID" ]]; then
    run_id="$RESUME_RUN_ID"
    log "恢复云效流水线运行：#$run_id"
  else
    log "启动云效流水线 $YUNXIAO_PIPELINE_ID"
    run_id="$(create_pipeline_run)"
    log "云效流水线运行编号：#$run_id"
  fi
  wait_for_pipeline "$run_id"
  if ((BUILD_ONLY)); then
    log "只构建流程完成；生产、CLI 和 Skill 均未修改"
    exit 0
  fi
  verify_service
  install_cli_and_skill
  log "全部完成：服务器、本机 CLI 和 Skill 已同步到 $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
}

main "$@"
