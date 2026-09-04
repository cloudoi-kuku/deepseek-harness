---
description: "工作区源能力缝（ctx.workspaceSource）：把本地或 Git 请求解析为持久 spec 并准备会话 cwd，且从不存储令牌。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-source

[English](README.md) | 中文

## 概述

`dsh-workspace-source`（`ctx.workspaceSource`）是宿主侧工作区源能力缝：提供者按 `kind` 注册，`resolve` 填满持久 spec，`prepare` 物化供 `session.create` 使用的本地 cwd。本地目录与 Git 远程是分开的提供者。spec 从不存储令牌；可选的 `credentialId` 只引用凭据存储中的记录。agent loop 仍然接收已解析的本地目录。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

先加载本服务，再挂载 `dsh-workspace-source-local` 和／或 `dsh-workspace-source-git`。`workspaceRegistry.create({ path })` 仍是本地路径 API。`createGit` 需要 git 提供者。

```yaml
- name: '@deepseek-ai/dsh-workspace-source'
- name: '@deepseek-ai/dsh-workspace-source-local'
- name: '@deepseek-ai/dsh-workspace-source-git'
- name: '@deepseek-ai/dsh-workspace'
```

已挂载本服务时，`session.create({ workspaceId })` 调用 `prepare(workspace.source)`。未挂载时，local 记录仍使用 `workspace.path`，因此先克隆再 `workspace.create({ path })` 的叠加层继续有效。

### 失败处理

未注册的 kind 在调用时抛出。重复 kind 在注册时抛出。未挂载 git 提供者时，仅 git 的方法会抛出。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

注册是 effect：`register` 返回处置器，并在 fiber 销毁时注销。`resolve` 不得 clone 或访问网络；`prepare` 才是 I/O 步骤。持久 `WorkspaceRecord.source` 字段存储 spec。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Git workspace-source 决策](../../../.agents/notes/implemented/architecture/2026-09-03-git-workspace-source.zh.md)
- [工作区子系统](../../../docs/subsystems/workspace.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型看到什么

无。`ctx.workspaceSource` 不注册工具、不注入提示词、不写入会话事件。

#### Token 影响

每次请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：本包绝不触及请求前缀。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- spec 上存储的 `credentialId` 尚未用于查找凭据；克隆使用进程的 Git 环境。
- Git 状态／提交／推送／拉取在本切片没有 Host RPC 或 UI。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
