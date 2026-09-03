# Agent Note: Git workspace source seam

Status: implemented

[English](2026-09-03-git-workspace-source.md) | 中文

## Problem

托管的 DeepSeek Harness（CoreNet 叠加层，以及之后的公开 Web IDE）需要的是 Git 检出，而不是笔记本上的文件夹。今天的注册表只存储 `{ path, title, sessionIds }`，且 `workspace.create({ path })` 要求目录已存在。叠加层自己克隆 `cloudoi-harness` 再钉住该路径——这条路径必须继续有效。公开产品不能继续把架构写成「一个托管 dsh web，把 `/workspace` 映射到 Git」；工作区记录上需要 Git 源、在 `session.create` 之前准备检出，并且持久记录中不得保存长期令牌。认证、按用户隔离、Git UX、IDE 界面和配额是后续问题。

## Decision

workspace 家族增加 workspace-source 能力缝。`ctx.workspaceSource` 是 Service Definition：提供者按 `kind` 注册，实现 `resolve(request) → spec` 再 `prepare(spec) → { cwd }`。`dsh-workspace-source-local` 处理已有目录；`dsh-workspace-source-git` 负责 clone/fetch、检出分支、报告 dirty/conflict，并能 commit/push/pull。spec 从不存储令牌；可选的 `credentialId` 只引用凭据缝中的记录，供后续查找。

持久 workspace 记录升到领域版本 3，并要求 `source`：

```ts
{ kind: 'local', path }
{ kind: 'git', provider: 'github' | 'generic', owner, repo, branch, remoteUrl, checkoutPath, credentialId? }
```

`workspace.create({ path })` 仍是本地路径。`workspace.createGit({ remoteUrl, checkoutParent, ... })` 是并列 API。`session.create({ workspaceId })` 在已挂载该缝时调用 `prepare(workspace.source)` 并用其 cwd；未挂载时，local 记录仍使用 `workspace.path`，因此只调用 `workspace.create({ path })` 的 CoreNet 叠加层继续有效。没有该缝的 git 记录会明确失败（`workspace-source-unavailable`）。

`dsh-web-app` 包会挂载定义以及两个提供者。产品级认证、按用户隔离、Git 宿主 RPC、配额以及其余 IDE 界面见 [hosted principal 切片](2026-09-03-hosted-principal-isolation.zh.md)。

## Alternatives considered

- **Git 只留在托管叠加层，OSS 工作区继续是 `{ path }`。** 否决：公开架构会停在「一个托管 dsh，把 `/workspace` 映射到 Git」，OSS 注册表无法命名 git 源，也无法在 session create 之前准备检出。
- **用联合请求替换 `create({ path })`。** 本切片否决：CoreNet 叠加层和所有本地目录选择器都调用 `workspace.create({ path })`。并列的 `createGit` 是加法。
- **把 GitHub 令牌存进 workspace 记录。** 否决：令牌属于凭据缝。记录最多保存 `credentialId`。
- **只在 `createGit` 时准备检出，跳过 `session.create`。** 否决：可丢弃缓存上的后续会话必须在 agent loop 看到 cwd 之前 fetch/快进。
- **改 `agent-loop` 让它理解 Git 工作区。** 否决：循环继续接收已解析的本地 cwd。

## Consequences

挂载 `ctx.workspaceSource` 的组合会在 git 的 `session.create` 与 `createGit` 时 clone 或 fetch。未挂载的组合保持原先的本地路径行为，这就是 CoreNet 叠加层契约。领域版本 4 增加可选 `owner`，并拒绝磁盘上的版本 3 workspace 单元（`version-mismatch`）；本仓库没有外部消费者。Git 操作已在缝上并以 Host RPC（`workspace.git*`）提供；源代码管理 UI 仍是后续工作。`credentialId` 在后续凭据接线之前不会被使用。按用户检出根目录、产品 principal 和配额见 [hosted principal 切片](2026-09-03-hosted-principal-isolation.zh.md)。容器隔离和 IDE 界面仍是后续工作。
