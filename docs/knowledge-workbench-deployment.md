# Knowledge Workbench deployment

The current baseline for this fork is EdgeEver 2.28.2 (upstream commit `30bd18fdfa48118da265f849b974f9fbd2f0f46f`) with the file-workspace API, atomic note revision checks, attachment metadata endpoints and standalone Node CLI 0.8.1 preserved. Larry's customization migrations now reach `0098`, adding primary-resource identity and format metadata for first-class file notes; the file-workspace contract remains at `protocolVersion: 1`.

`LarryGuan/edgeever` is the only production source. For this first cross-version upgrade, run `./auto/update.sh --build-only`: it checks and synchronizes `main`, tests the standalone CLI, and asks Yunxiao pipeline `5282954` to build a Linux amd64 image in `registry.cn-hangzhou.aliyuncs.com/larryguan/edgeever_zzy`, then stops at `deploy=SWITCH_MANUAL`. Only after an isolated same-host validation against a cold copy of production data should the operator use the emitted `./auto/update.sh --resume-run <run-id>` command to release that exact run and update the local CLI/Skill. Do not use the all-in-one `--run` path for this first upgrade.

Yunxiao does not publish npm or upstream desktop/mobile releases. The obsolete fork-only GitHub image workflow has been removed so it cannot conflict with the upstream gate that reserves Actions jobs for the official repository. The upstream auto-sync job explicitly excludes this fork so unattended jobs cannot replace customized code. Future upstream releases must be manually reviewed, tested and merged. The `/api/openapi.json` reachability probe remains; extension API documentation is in `file-workspace.openapi.json`.

Before deployment, back up the full production `/data` volume and Compose configuration outside the repository. Validate the new image against an isolated copy of the previous instance, including existing data readability and file-workspace pull/push/conflicts/attachments. Change only the production service image after validation. Keep the old image and backup available. A failed upgrade should restore the previous image; restore the data backup if a future version changes database state incompatibly. Never run two server instances against the same SQLite volume.

Runtime credentials, databases, note content and backup archives must not enter Git or public build artifacts. This fork's source remains under the upstream AGPL license.

## Current Production Deployment Record — 2026-11-19

- Production code commit: `a73e0af291e3a25a362d2fe25306d1774e3effde`.
- Yunxiao run: `#11`; both build and deploy completed with `SUCCESS`.
- Production image: `registry.cn-hangzhou.aliyuncs.com/larryguan/edgeever_zzy:2026-11-19-04-40-31`.
- Image digest: `sha256:77f8de7c01249c96640adfbe2b38d955f2f3d032eef0658ff90162fe41b7cab0`.
- Production cold backup: `/data/edgeever/backups/20261118T204302Z-1452927`, with a non-empty full `data.tgz` archive.
- Live `/api/health` returned `ok=true` and `migration=0098`; OpenAPI was reachable and the container reported `healthy`.
- An authenticated read through the existing `openbox` profile returned 45 visible notebooks.
- The local CLI and Claude Skill are now `0.8.1`; `~/.agents/skills/edgeever` remains a symlink to the Claude Skill.
- CLI `0.8.0` rollback package: `~/.local/state/edgeever/automation-backups/20261119T044249/knowledge-workbench-edgeever-cli-0.8.0.tgz`.

## Previous Production Deployment Record — 2026-11-17

- Production commit: `f027935f185d6ca8acafc6a3e5de35a9c812a6a8`, pinned to upstream `v2.28.2` / `30bd18fdfa48118da265f849b974f9fbd2f0f46f`.
- Yunxiao run: `#6`; build and deploy both `SUCCESS`.
- Production image: `registry.cn-hangzhou.aliyuncs.com/larryguan/edgeever_zzy:2026-11-17-17-29-48`.
- Image digest: `sha256:57048895272559869bbe1b38e91fc40153a1c29bd7f818859f91bd04216f4b33`.
- Isolated-validation cold backup: `/data/edgeever/backups/20261117T173337+0800-pre-v2.28.2`; validation root `/data/edgeever-staging/20261117T173337+0800-v2.28.2`, stopped after validation.
- Production deployment cold backup: `/data/edgeever/backups/20261117T095441Z-1029770`.
- Migration: `0050 → 0095`. All 67 note bodies and 42 resource metadata fingerprints match before and after; counts remain 53 notebooks, two workspaces, and two users.
- The local CLI and Claude Skill are both `0.8.0`; `~/.agents/skills/edgeever` still links to the Claude Skill.
- The public IP certificate was renewed with the existing Certbot installation; OpenResty was not reinstalled. The renewal service temporarily selects Mihomo `global/DIRECT` and restores the previous network mode afterward so a failed proxy node cannot block ACME.
- Full commands, gate results, isolated validation, and rollback boundaries are recorded in `upstream-upgrade-v2.28.2-plan.md`.

## Historical verified deployment — 2026-09-16

The following record belongs to the predecessor `a20070322` baseline. It is retained for audit history and does not claim that the 2.28.2 upgrade has been verified or released.

- Fork: https://github.com/a20070322/edgeever
- Runtime commit: `a98478bcbb6ba75566471c54b2e297bafc04574a`.
- Successful build: https://github.com/a20070322/edgeever/actions/runs/35068407923
- Registry digest: `sha256:cc959d36d443e49e67bd3357fb21a3b220940a242b5b51875ea5462e334a6993`.
- Exported image archive SHA-256: `ce10531893f2a9053f8870cdaaaa8feb2bbc1b7510220bc9d834f5c3f7e9f678`.
- API typecheck, 60 affected tests, standalone npm tests and Linux amd64 container build passed.
- An isolated copy of the previous production instance passed existing-note reads, CLI link/pull/push, PDF upload/download with matching hash, and conflict preservation.
- Production retained migration `0048` and the same note/resource fingerprint. The authenticated capability endpoint returned 200 and a read-only CLI pull succeeded.
- The validation container and copied business data/temporary credentials were removed. Full cold backup, old image and the verified image archive remain on the deployment host. No Windows or live Cloudflare validation was performed.

The published image may require registry authentication depending on package visibility. This deployment loaded the verified Actions image archive instead of relying on the host's registry connection.
