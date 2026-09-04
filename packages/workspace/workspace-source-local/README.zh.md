---
description: "ctx.workspaceSource 的本地目录提供者：把已有宿主路径准备为会话 cwd。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-source-local

[English](README.md) | 中文

## 概述

此提供者在 `ctx.workspaceSource` 上注册 `kind: 'local'`。`resolve` 记录请求路径；`prepare` 用 `fs.realpath` 规范化，并要求目录已存在。`workspace.create({ path })` 仍要求目录已存在。

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
- name: '@deepseek-ai/dsh-workspace-source-local'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

该插件是 Cordis `Service`，只把本地提供者注册进 `ctx.workspaceSource`。

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

- 此提供者不创建目录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
