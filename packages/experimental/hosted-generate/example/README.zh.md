---
description: "在 agent spine 上提供文件系统写入工具且关闭 bash 的可运行 loopback 生成组合，供 CoreNet 与 Hosting POC 调用方使用。"
kind: "package-reference"
---

# hosted-generate

[English](README.md) | 中文

## 概述

在 agent spine 上挂载 [`dsh-experimental-hosted-generate`](../README.zh.md) 的 loopback 组合，提供文件系统写入工具且 **没有 bash**。已登录产品（CoreNet 或 Hosting）POST prompt 并收到 UTF-8 文件映射；由该产品负责部署。

本叶子是成本受限的 POC：绑定 `127.0.0.1`、同时只跑一次生成、没有 Azure session 容器，无密钥测试使用 `dsh-llm-mock-server`，因此 CI 不花费模型 token。它不是已发布的 npm 包，也不增加 `dsh --profile` 入口。

## 目录

- [测试（无密钥）](#test-keyless)
- [Azure（Envon，缩到零）](#azure-envon-scale-to-zero)
- [HTTP](#http)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="test-keyless"></a>
## 测试（无密钥）

在本仓库根目录运行：

```sh
pnpm run test:hosted-generate
```

这是应先跑的路径。Vite 可能打印 `vite-tsconfig-paths` 插件提示；那是警告，不是失败。

若要自己 curl API（仍不需要 provider key）：

```sh
pnpm run demo:hosted-generate
```

然后在另一个终端：

```sh
curl -sS -X POST http://127.0.0.1:3081/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"a one-page hello site"}'
# wait for completed, replacing SESSION with the returned sessionId
curl -sS http://127.0.0.1:3081/sessions/SESSION
curl -sS http://127.0.0.1:3081/sessions/SESSION/artifact
```

mock 会在第一次生成时写入固定的 `index.html`。可选的真实模型 smoke（无 `DEEPSEEK_API_KEY` 时自行跳过）位于 [`../tests/live.e2e.ts`](../tests/live.e2e.ts)，属于 `pnpm run test:e2e`。

-----

<a id="azure-envon-scale-to-zero"></a>
## Azure（Envon，缩到零）

线上应用 `ca-envon-generate-poc` 部署在 `cae-envon-prd-eus2-01`，在 `https://harness.cloudoi.io` 于 **`/` 提供 `dsh web`**，并提供 generate HTTP 约定。镜像：`packages/experimental/hosted-generate/example/azure/Dockerfile.web`，从仓库根目录构建，因此 `dsh` 含 `workspace-source-git`。`dsh web` 绑定 `127.0.0.1:3080`，cwd 为 `/workspace`；`generate-server.mjs` 绑定 `127.0.0.1:3081`，并以 `grok.patch.yml` 加 `generate.patch.yml`（仅文件系统工具）运行 `dsh --profile headless`。`web-proxy.mjs` 绑定 `0.0.0.0:8080`，并把 `/generate` 与 `/sessions/` 转到 generate 服务。未认证浏览器收到落地页，提供 CloudOI 登录（`HARNESS_CORENET_ORIGIN/app/harness-launch`）和 `GENERATE_TOKEN` Git IDE，不会被重定向到 CoreNet。有效的 `/?launch=` token 会请求 `GET /api/ai-build/from-harness/workspace`，把该 GitHub 仓库克隆进 `/workspace`，对该目录 POST dsh `workspace.create`（标题为 `owner/name`）使输入框可直接使用而无需目录选择器，再 302 到 `/`。`GENERATE_TOKEN`（HTTP Basic 密码 / Bearer）打开 `dsh web` 且不固定该目录；`POST /clone` `{ remoteUrl }` 调用 dsh `workspace/createGit`，检出在 `/workspace/<owner>-<repo>`。`/new` 重定向到 `/`。`--trusted-host` 为 `harness.cloudoi.io`。线上组合不挂载 `principal-hmac`。扩缩容：`minReplicas=0` / `maxReplicas=1`，1.0 vCPU / 2 Gi。

默认模型是 Grok。`llm-bridge.mjs` 把 pi-ai 的 OpenAI 兼容 loopback 调用转到 Envon Foundry 部署 `grok-4-3`（`FOUNDRY_API_KEY`，CAE VNet 上的私有 PE）。不设 `FOUNDRY_API_KEY` 而设 `XAI_API_KEY` 时改走 `https://api.x.ai/v1`（模型 `grok-4.3`）。

`Dockerfile` + `server.mjs` 仍是无密钥的 generate 约定 mock（无 dsh、无模型 token）。Envon harness 同时接受 CoreNet 登录和独立 Git IDE：CoreNet launch token（`GET /api/ai-build/harness-launch` → `/?launch=`）把会话绑到该账号并把 GitHub 挂为 cwd；`GENERATE_TOKEN` 打开 `dsh web` 和 `/clone`，不经过 CoreNet。向导的 `POST /generate` 仍调用 `POST /api/ai-build/from-harness/launch`，由 CoreNet 写站点仓库和 `{slug}.cloudoi.dev`。隔离仍不是多租户。

-----

<a id="http"></a>
## HTTP

| Method | Path |
|---|---|
| `POST` | `/generate` `{ "prompt": "…" }` → `{ "sessionId" }` |
| `GET` | `/sessions/:id` |
| `GET` | `/sessions/:id/artifact` |

设置 `DSH_HOSTED_GENERATE_TOKEN` 以要求 `Authorization: Bearer`。`DSH_HOSTED_GENERATE_PORT` 默认为操作系统分配的端口。

## Known Limitations and Deferred Work

见包 README。本叶子不增加 `dsh --profile` 入口，也不绑定全部网卡。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

无。

</details>
