---
description: "从一次性工作区返回 UTF-8 文件映射的 loopback 生成 API，供 CoreNet 与 Hosting 组合自行部署这些文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-hosted-generate

[English](README.md) | 中文

## 概述

当已登录产品需要 POST prompt 并收到可自行部署的 UTF-8 文件映射时，挂载此实验服务。`ctx.hostedGenerate` 为每次请求在一次性工作区中创建 Agent，在时间和 step 上限内等待静止，返回文件，然后擦除该工作区。它不部署、不写 DNS，也不持有产品凭证。隔离是单进程加临时目录，不是容器。

[hosted-generate Agent Note](../../../.agents/notes/implemented/feature/2026-08-28-hosted-generate-poc.zh.md) 负责隔离、成本以及生成/部署分离的决策。可运行叶子在 [`example/`](example/README.zh.md)。

## 目录

- [配置](#config)
- [HTTP](#http)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="config"></a>
## 配置

```yaml
- id: hosted-generate
  name: '@deepseek-ai/dsh-experimental-hosted-generate'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
    maxConcurrentSessions: 1
    sessionTimeoutMs: 30000
    maxSteps: 6
    maxArtifactBytes: 262144
    maxFiles: 16
    maxFileBytes: 65536
    maxPromptBytes: 16384
    maxRetainedSessions: 8
    workspaceParent: /tmp
    authToken: ''
    printListen: false
```

`provider` 与 `model` 为必填。其余字段均有默认值。`authToken` 为空时关闭 HTTP 认证。在已挂载 `ctx.webServer` 时，`printListen` 会写入一行 loopback URL。

-----

<a id="http"></a>
## HTTP

当挂载 `ctx.webServer` 时，插件注册：

| 方法 | 路径 | 结果 |
|---|---|---|
| `POST` | `/generate` | `202 { sessionId }` |
| `GET` | `/sessions/:id` | 状态 |
| `GET` | `/sessions/:id/artifact` | `{ sessionId, files }` |

`files` 是 posix 相对路径的 UTF-8 映射。隐藏名、`node_modules`、`.git`、`.sessions` 以及非 UTF-8 字节会被省略。超过 `maxFiles` 或字节上限会使本次生成失败。由产品负责部署该映射；本插件从不部署。

-----

<a id="model-experience"></a>
## Model Experience

### Generation instructions

#### What the model sees

`app:hosted-generate` 系统提示 section（order −50）携带 `taskGuidance`。同一段文字会作为 `User request:` 前缀加到用户 prompt 前。

##### Default `taskGuidance`

```markdown
Generate a static website or small app in this workspace. Write UTF-8 files under the workspace root. Do not deploy, do not use network services, and do not read files outside the workspace. Stop when the files are ready.
```

#### Token effect

每个 session 一段恒定说明，外加用户 prompt。

#### KV Cache effect

该 section 在进程内稳定。用户 prompt 为只追加。

## Known Limitations and Deferred Work

- **仅进程内隔离** — 本 POC 不含 Landlock/Seatbelt 与按 session 的容器；绑定 loopback，并将 `maxConcurrentSessions` 保持为 1。
- **无部署、DNS 或 GitHub** — 由调用方持久化并发布文件映射。
- **LLM 花费属于调用方的 adapter** — 本包从不持有 provider key；测试使用 mock 或 `dsh-llm-mock-server`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

无。

</details>
