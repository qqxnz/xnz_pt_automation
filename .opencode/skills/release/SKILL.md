---
name: release
description: |
  发布新版本。同步更新 9 处版本号、生成 x86_64 和 arm64 两个 fnOS fpk 包到 fpk/ 目录、git 提交、打 annotated tag、推送 main 分支和 tag 到 origin。
  当用户说「发版」「发布版本」「release」「打 tag」「bump version」「升级到 X.Y.Z」「发新版本」时使用。
---

# Release Skill

一键发布新版本到 GitHub。

## 参数

`$ARGUMENTS`（可选）：目标版本号。

支持以下形式：
- 不传：读取 `package.json` 中当前版本号，PATCH + 1
- `0.6.4`：完整版本号
- `0.7` / `0.7.0`：短形式（自动补全）
- `major` / `minor` / `patch`：按 semver 关键字递增
- `--dry-run`：只打印将执行的操作，不实际写入文件或推送到远端

## 前置条件

- 当前在 git 仓库根目录
- 在 `main` 分支（其他分支先 `git checkout main`）
- `fnpack` **不需要预装**，脚本会在检测不到时自动从飞牛官方下载到 `~/.local/bin/fnpack`
- 工作区除本技能将要创建/修改的文件外应保持干净

## 同步更新的版本号位置（9 处）

| 文件 | 字段 |
|---|---|
| `package.json` | `"version"` |
| `backend/package.json` | `"version"` |
| `frontend/package.json` | `"version"` |
| `Dockerfile` | `ARG VERSION=` |
| `fnos/manifest` | `version=` |
| `fnos/app/docker/docker-compose.yaml` | 镜像默认 tag |
| `fnos/wizard/install` | `initValue` |
| `fnos/wizard/upgrade` | `initValue` |
| `fnos/i18n/zh-CN` | `help_image_tag` 文案 |

## 流程

### 1. 解析目标版本

```bash
CURRENT=$(node -p "require('./package.json').version")
```

按 `semver` 规则计算新版本号。如不传参则取 PATCH + 1。

### 2. 前置检查

- `git status --porcelain` → 仅允许存在 `fnos/`、`fpk/`、要发版的文件
- `git rev-parse v{NEW}` 不存在（tag 冲突则中止）
- `git remote get-url origin` 必须指向 `qqxnz/xnz_pt_automation`
- `command -v fnpack` 如不存在，调用 `fnos/build_all.sh` 时会**自动安装**到 `~/.local/bin/fnpack`（不需 sudo）

### 3. 同步 9 处版本号

对每个文件用 `sed -i ''`（macOS）或 `sed -i`（Linux）替换旧版本号为新版本号。打印每个文件的 diff 摘要。

### 4. 编译双架构 fpk

```bash
bash fnos/build_all.sh {NEW_VERSION}
```

该脚本会：
- 创建 `fpk/` 目录
- 先用 `arch=x86_64` 调 `fnpack build` → `fpk/qqxnz.xnz-pt-automation-{ver}-x86_64.fpk`
- 再用 `arch=arm64` 调 `fnpack build` → `fpk/qqxnz.xnz-pt-automation-{ver}-arm64.fpk`
- 还原 manifest 的 `arch=x86_64`
- **生成的 fpk 会进入 git**（`fpk/` 不在 `.gitignore` 中）

> 当前主机架构无法运行的某个架构会失败（如 macOS arm64 主机打不出 x86_64 包），脚本会跳过并在汇总中标注。`--dry-run` 时不执行。

### 5. git 提交

```bash
git add -A
git commit -m "release: v{NEW_VERSION}"
```

### 6. 打 annotated tag

```bash
git tag -a "v{NEW_VERSION}" -m "v{NEW_VERSION}"
```

### 7. 推送

```bash
git push origin main
git push origin "v{NEW_VERSION}"
```

`--dry-run` 跳过此步。

### 8. 输出摘要

```
✅ 发布完成
  版本：0.6.4
  提交：<hash>
  Tag：v0.6.4
  fpk 包：
    - fpk/qqxnz.xnz-pt-automation-0.6.4-x86_64.fpk
    - fpk/qqxnz.xnz-pt-automation-0.6.4-arm64.fpk
  Release：https://github.com/qqxnz/xnz_pt_automation/releases/tag/v0.6.4
```

## 失败处理

| 失败 | 处理 |
|---|---|
| tag 已存在 | 中止，要求换版本号 |
| 工作区有非相关 dirty | 中止，要求先 `git stash` / `git commit` |
| 远端非 `qqxnz/xnz_pt_automation` | 中止，要求确认 |
| `fnpack` 未安装 | **自动下载**到 `~/.local/bin/fnpack`；下载失败才中止 |
| `fnpack build` 某架构失败 | 跳过该架构，继续流程，汇总中标注 |
| `git push` 失败 | 保留本地 commit + tag，提示用户手动 push；不自动 `--force` |

## dry-run 输出

仅打印将要执行的所有命令和文件改动，不写入任何文件、不推送。

## 安全提示

- 全自动模式（无确认）。`--dry-run` 用于预演。
- 不强推（不会执行 `git push --force`）。
- 不删除已有 tag。
- 不修改 main 以外的分支。
