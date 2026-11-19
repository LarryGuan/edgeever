# 知识工作台部署

本 Fork 的当前基线为 EdgeEver 2.28.2（上游提交 `30bd18fdfa48118da265f849b974f9fbd2f0f46f`），并保留工作目录 API、笔记原子版本检查、附件元数据接口及独立 Node CLI 0.8.2。Larry 定制迁移当前到 `0098`，新增一等文件笔记的主资源身份与格式标识；文件工作区协议继续使用 `protocolVersion: 1`。

正式发布源仅为 `LarryGuan/edgeever`。首次跨版本升级先运行 `./auto/update.sh --build-only`：脚本检查并同步 `main`、测试独立 CLI、触发云效流水线 `5282954` 构建 Linux amd64 镜像到 `registry.cn-hangzhou.aliyuncs.com/larryguan/edgeever_zzy`，然后停在 `deploy=SWITCH_MANUAL`。生产数据冷副本的同机隔离验证通过后，才使用脚本输出的 `./auto/update.sh --resume-run <运行号>` 放行同一次运行，并更新本机 CLI/Skill。首次升级禁止直接使用一体化 `--run`。

云效发布不发布 npm 包或上游桌面/移动端 Release。旧的 Fork 专用 GitHub 镜像工作流已经移除，避免与上游仅允许官方仓库运行 Actions Job 的门禁冲突。本 Fork 明确排除上游自动同步任务，避免无人值守时替换定制代码；后续升级须人工复审和验证后合并。保留 `/api/openapi.json` 连通性探针；扩展接口说明放在 `file-workspace.openapi.json`。

部署前，在仓库外备份生产 `/data` 全卷和 Compose 配置。用旧实例的隔离副本验证新镜像，包括旧数据读取、工作目录拉取/回写/冲突/附件。验证通过后仅替换生产服务镜像，保留旧镜像及备份。升级失败时恢复旧镜像；若未来版本产生不兼容数据变化，则恢复升级前数据。严禁两个服务实例共用同一个 SQLite 卷。

凭据、数据库、笔记正文和备份不得进入 Git 或公开构建产物。Fork 源码继续遵守上游 AGPL 许可证。

## 当前生产部署记录 — 2026-11-19

- 生产代码提交：`a73e0af291e3a25a362d2fe25306d1774e3effde`。
- 云效运行：`#11`，build 与 deploy 均为 `SUCCESS`。
- 生产镜像：`registry.cn-hangzhou.aliyuncs.com/larryguan/edgeever_zzy:2026-11-19-04-40-31`。
- 镜像摘要：`sha256:77f8de7c01249c96640adfbe2b38d955f2f3d032eef0658ff90162fe41b7cab0`。
- 生产部署冷备：`/data/edgeever/backups/20261118T204302Z-1452927`，其中 `data.tgz` 为非空完整数据归档。
- 线上 `/api/health` 返回 `ok=true`、`migration=0098`，OpenAPI 可访问；容器处于 `healthy`。
- 使用现有 `openbox` Profile 完成认证读取，返回 45 个可见笔记本。
- 本机 CLI 与 Claude Skill 已更新为 `0.8.2`，`~/.agents/skills/edgeever` 仍软链到 Claude Skill。
- CLI `0.8.0` 回滚包：`~/.local/state/edgeever/automation-backups/20261119T044249/knowledge-workbench-edgeever-cli-0.8.0.tgz`。

## 上一生产部署记录 — 2026-11-17

- 生产提交：`f027935f185d6ca8acafc6a3e5de35a9c812a6a8`，固定上游 `v2.28.2` / `30bd18fdfa48118da265f849b974f9fbd2f0f46f`。
- 云效运行：`#6`，build 与 deploy 均为 `SUCCESS`。
- 生产镜像：`registry.cn-hangzhou.aliyuncs.com/larryguan/edgeever_zzy:2026-11-17-17-29-48`。
- 镜像摘要：`sha256:57048895272559869bbe1b38e91fc40153a1c29bd7f818859f91bd04216f4b33`。
- 隔离验证冷备：`/data/edgeever/backups/20261117T173337+0800-pre-v2.28.2`；隔离实例根目录 `/data/edgeever-staging/20261117T173337+0800-v2.28.2`，验证后已停止。
- 生产部署冷备：`/data/edgeever/backups/20261117T095441Z-1029770`。
- Migration：`0050 → 0095`。升级前后 67 篇笔记正文和 42 条资源元数据指纹一致；53 个笔记本、2 个工作区和 2 个用户数量一致。
- 本机 CLI 与 Claude Skill 均为 `0.8.0`，`~/.agents/skills/edgeever` 仍软链到 Claude Skill。
- 公网 IP 证书已使用现有 Certbot 续签；未重装 OpenResty。续签服务会临时切换 Mihomo 到 `global/DIRECT`，结束时恢复原网络模式，避免失效代理节点阻断 ACME。
- 完整命令、测试结果、隔离验证和回退边界记录在 `upstream-upgrade-v2.28.2-plan.zh-CN.md`。

## 历史部署验证记录 — 2026-09-16

以下记录属于前代 `a20070322` 基线，仅作为审计历史，不代表 2.28.2 升级已经验证或发布。

- Fork：https://github.com/a20070322/edgeever
- 运行提交：`a98478bcbb6ba75566471c54b2e297bafc04574a`。
- 构建成功：https://github.com/a20070322/edgeever/actions/runs/35068407923
- 镜像仓库摘要：`sha256:cc959d36d443e49e67bd3357fb21a3b220940a242b5b51875ea5462e334a6993`。
- 导出镜像归档 SHA-256：`ce10531893f2a9053f8870cdaaaa8feb2bbc1b7510220bc9d834f5c3f7e9f678`。
- API 类型检查、60 项相关测试、独立 npm 测试及 Linux amd64 容器构建通过。
- 旧生产实例的隔离副本通过旧笔记读取、CLI link/pull/push、PDF 上传下载哈希一致及冲突保留验证。
- 生产仍使用 migration `0048`，笔记/附件元数据指纹未变化；鉴权能力接口返回 200，只读 CLI 拉取成功。
- 已移除验证容器、业务数据副本和临时凭据；完整冷备份、旧镜像和已验证的镜像归档保留在部署主机。未执行 Windows 或真实 Cloudflare 验证。

镜像是否需要仓库鉴权取决于包可见性；本次使用经校验的 Actions 镜像归档导入，不依赖部署主机直连镜像仓库。
