---
description: "ctx.workspaceSource 的 Git 提供者：clone、fetch、status、commit、push、pull 与分支切换，且从不存储令牌。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-source-git

[English](README.md) | 中文

## 概述

此提供者在 `ctx.workspaceSource` 上注册 `kind: 'git'`。`resolve` 从 GitHub URL（或显式 owner/repo）填满 owner、repo、branch，以及 `checkoutParent/${owner}-${repo}` 下的 `checkoutPath`。目标没有 `.git` 时 `prepare` 会 clone；否则 fetch、检出记录的分支并快进 pull。status、commit、push、pull 与分支切换在 `ctx.workspaceSource.git()` 上。spec 从不存储令牌。

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

在 `dsh-workspace-source` 之后挂载。没有配置项。

```yaml
- name: '@deepseek-ai/dsh-workspace-source'
- name: '@deepseek-ai/dsh-workspace-source-git'
```

随后 `workspace.createGit({ remoteUrl, checkoutParent, ... })` 会在写入工作区记录之前 clone 或 fetch。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

该插件是 Cordis `Service`，注册一个 git 提供者。克隆使用 `git` 二进制且不嵌入凭据。`credentialId` 被记录但尚未使用。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-workspace-source`](../workspace-source/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型看到什么

无。此提供者注册进 `ctx.workspaceSource`，不贡献工具、提示词或会话事件。

#### Token 影响

每次请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：本包绝不触及请求前缀。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 内置只解析 GitHub URL；其他远程需要显式 `owner` 与 `repo`。
- `credentialId` 尚未使用；Git 使用进程环境。
- pull 只允许快进。
- 源代码管理 UI 与 git RPC 属于后续阶段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
