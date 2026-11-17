# EdgeEver 自动发布

`update.sh` 把当前 GitHub `main` 发布到云效，并在云端部署成功后更新本机 EdgeEver CLI 与 Claude Code Skill。

## 使用

默认运行只做安全演练，不会同步代码、触发云效或修改本机安装：

```bash
./auto/update.sh
```

确认演练通过后，显式执行正式更新：

```bash
./auto/update.sh --run
```

`./auto/update.sh --dry-run` 与无参数运行效果相同。脚本会在没有受跟踪本地修改时，自动用 `git pull --ff-only` 安全同步 GitHub `main`。如果网络异常、存在本地修改或分支已经分叉，脚本会停止并给出错误提示，云效不会被触发。

脚本启动后的第一行会明确显示“检查模式”或“正式执行”，并说明该模式是否会修改代码、触发云效和更新本机安装。

GitHub 版本检查最多等待 15 秒，正式 Git 同步默认最多等待 120 秒。超时会明确报错并停止，云效不会被触发。

如果本机脚本在云效运行创建后意外退出，可使用 `./auto/update.sh --resume-run ID` 恢复该次运行，避免重复创建流水线。

脚本会依次完成：

1. 确认当前仓库是 `LarryGuan/edgeever` 的 `main`，并自动执行只允许快进的 Git 同步。
2. 测试并打包仓库中的 CLI，同时把当前全局 CLI 备份到 `~/.local/state/edgeever/automation-backups/`。
3. 通过云效 OpenAPI 启动流水线 `5282954`。
4. 镜像构建成功后，自动启动原来需要手工点击的部署任务。
5. 等待部署成功并检查 `https://115.191.43.203:8788/api/health`。
6. 将 CLI 安装到当前实际使用的 Node.js/FNM 目录。
7. 更新 `~/.claude/skills/edgeever`，并确认 `~/.agents/skills/edgeever` 仍是指向它的软链接。

## 配置与安全

脚本从以下文件读取令牌，不会把令牌复制进 Git 仓库：

```text
~/.config/aliyun-devops/env.sh
```

文件需要提供：

```bash
ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN=...
ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID=...
```

可通过环境变量覆盖流水线 ID、轮询周期、超时和健康检查地址，完整列表见：

```bash
./auto/update.sh --help
```

## 失败与恢复

任何步骤失败都会立即停止，CLI 和 Skill 只会在云效部署成功且线上健康检查通过后更新。

服务器部署脚本会在数据库迁移前，把数据和部署配置冷备份到服务器的 `/data/edgeever/backups/`。数据库不会自动回滚；部署失败时，应先查看云效日志和容器日志，再选择对应备份人工恢复。

本机 CLI 更新前会打印回滚包路径和完整回滚命令。Skill 更新使用 EdgeEver CLI 自带的备份机制。
