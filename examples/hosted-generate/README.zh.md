# hosted-generate

[English](README.md) | 中文

在 agent spine 上挂载 [`dsh-experimental-hosted-generate`](../../packages/experimental/hosted-generate/README.zh.md) 的 loopback 组合，提供文件系统写入工具且 **没有 bash**。已登录产品（CoreNet 或 Hosting）POST prompt 并收到 UTF-8 文件映射；由该产品负责部署。

本示例是成本受限的 POC：绑定 `127.0.0.1`、同时只跑一次生成、没有 Azure session 容器，无密钥测试使用 `dsh-llm-mock-server`，因此 CI 不花费模型 token。

## Test (keyless)

在本仓库根目录运行（grok worktree，不是另一份 clone）：

```sh
pnpm run test:hosted-generate
```

这是应先跑的路径。Vite 可能打印 `vite-tsconfig-paths` 插件提示；那是警告，不是失败。套件在打印 `Tests  22 passed` 时为绿。

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

mock 会在第一次生成时写入固定的 `index.html`。可选的真实模型 smoke（无 `DEEPSEEK_API_KEY` 时自行跳过）位于 `tests/live.e2e.ts`，属于 `pnpm run test:e2e`。

## Azure (Envon, scale to zero)

线上应用 `ca-envon-generate-poc` 部署在 `cae-envon-prd-eus2-01`，同时提供 Harness **web UI** 与 generate HTTP 约定。镜像：`examples/hosted-generate/azure/Dockerfile.web`，从仓库根目录构建，因此 `dsh` 含 `workspace-source-git`。`dsh web` 绑定 `127.0.0.1:3080`；`generate-server.mjs` 绑定 `127.0.0.1:3081`，以 `grok.patch.yml` 加 `generate.patch.yml`（仅文件系统工具）运行 `dsh --profile headless`，并由 `corenet-bridge.mjs` 提供 `/corenet/publish|database`。`web-proxy.mjs` 绑定 `0.0.0.0:8080`，接受 CoreNet HMAC launch token（`harness_launch`）或操作者 `GENERATE_TOKEN`（HTTP Basic 密码或 Bearer），经 `workspace-github.mjs` 克隆 GitHub grant，再用 `workspace.create({ path })` 钉住 `/workspace`。默认 `--trusted-host` 为 `harness.cloudoi.io`。线上组合不挂载 `principal-hmac`。扩缩容：`minReplicas=0` / `maxReplicas=1`，1.0 vCPU / 2 Gi。

默认模型是 Grok。`llm-bridge.mjs` 把 pi-ai 的 OpenAI 兼容 loopback 调用转到 Envon Foundry 部署 `grok-4-3`（`FOUNDRY_API_KEY`，CAE VNet 上的私有 PE）。不设 `FOUNDRY_API_KEY` 而设 `XAI_API_KEY` 时改走 `https://api.x.ai/v1`（模型 `grok-4.3`）。

`Dockerfile` + `server.mjs` 仍是无密钥的 generate 约定 mock（无 dsh、无模型 token）。Envon harness 是 CloudOI 的界面，不是独立的 dsh 登录：CoreNet launch token（`GET /api/ai-build/harness-launch`）把会话绑到该账号，完成后的 generate 调用 `POST /api/ai-build/from-harness/launch`，由 CoreNet 写 GitHub 和 `{slug}.cloudoi.dev`。操作者 `GENERATE_TOKEN` 仍用于演练。隔离仍不是多租户。

## HTTP

| Method | Path |
|---|---|
| `POST` | `/generate` `{ "prompt": "…" }` → `{ "sessionId" }` |
| `GET` | `/sessions/:id` |
| `GET` | `/sessions/:id/artifact` |

设置 `DSH_HOSTED_GENERATE_TOKEN` 以要求 `Authorization: Bearer`。`DSH_HOSTED_GENERATE_PORT` 默认为操作系统分配的端口。

## Known Limitations and Deferred Work

见包 README。本叶子不增加 `dsh --profile` 入口，也不绑定全部网卡。
