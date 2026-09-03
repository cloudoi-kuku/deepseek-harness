# Agent Note: Hosted generate POC for CoreNet and Hosting

Status: implemented

[English](2026-08-28-hosted-generate-poc.md) | 中文

## Problem

CoreNet 与 Hosting 都需要让已登录用户描述网站或应用，并得到产品可以部署的文件。现有构建器是一次性文本填充。DeepSeek Harness 可以运行带工具的 Agent，但它是本地单操作者运行时：匿名身份、默认仅 loopback 的 Web、进程内 sandbox，以及没有 generate/artifact HTTP 约定。把现成的 `dsh web` UI 放到 Envon 计算上会暴露远程代码执行和无上限的模型花费。

共享生成器不得写 DNS 或部署，不得持有 provider key；成本受限的 POC 也不能为每个 session 开通 Azure 容器，或在 CI 中调用付费模型。

## Decision

`@deepseek-ai/dsh-experimental-hosted-generate` 是私有实验服务（`ctx.hostedGenerate`），并可选用 `ctx.webServer` 上的路由。每次 `start()` 创建一个一次性目录、一个 `cwd` 为该目录的 Agent，在 `sessionTimeoutMs` 与 `maxSteps` 内等待静止，收集 UTF-8 文件映射，销毁 Agent，并删除该目录。已完成记录保留在进程内存中，上限为 `maxRetainedSessions`。默认 `maxConcurrentSessions` 为 1。HTTP 经由现有 web server 绑定，示例组合中仍为 loopback。`authToken` 为空时关闭 bearer 检查；非空时要求 `Authorization: Bearer`。

该插件从不部署、从不写 DNS、也从不存储 provider key。LLM 流量使用组合中挂载的 adapter。无密钥测试驱动 `MockAdapter` 或 `dsh-llm-mock-server`。Envon harness 是 CloudOI 的一个界面：CoreNet（以及之后的 Hosting）在自身登录之后签发 launch token，因此用户不是第二个账号。`POST /api/ai-build/from-harness` 是 CoreNet 的发布路径（GitHub + `*.cloudoi.dev`）。产品仍然是 GitHub、DNS 与托管资源的唯一写入者。

本 POC 的隔离是一个 Node 进程加临时目录，不是 Landlock，也不是容器。这只适用于 loopback、单租户、受信任操作者的演练。

示例叶子 `examples/hosted-generate` 在 `dsh-agent-spine-demo` 之上组合该服务，并设置 `toolBash: false` 与 `toolJobs: false`，因此 Agent 可以写文件但不能启动子进程。这让 POC 避开 `npm install` 与镜像构建。

## Alternatives considered

**在 `0.0.0.0` 上发布 Web profile。** 对开源 CLI 否决：它阻止全接口绑定，因为那会暴露工具运行时，且 web server 没有认证。带一次性 cwd 的 generate API 是更小的产品约定。Azure 演练仍遵守该 CLI 拒绝：`dsh web` 绑定 `127.0.0.1:3080`，由 `examples/hosted-generate/azure/web-proxy.mjs` 在 `0.0.0.0:8080` 上发布，并以 `GENERATE_TOKEN` 作为 Basic 密码或 Bearer。这是单操作者访问控制，不是多租户隔离。

**按 session 使用 Azure Container Instances。** 本 POC 否决：空闲与按次 ACI 成本高于必须无密钥运行的演练。服务接口以后可以把工作区创建换成远程 execution-world provider，而不必改 HTTP 映射。

**Tarball 产物。** 否决：CoreNet 已经接收 path-to-content 映射，Hosting 的静态发布器要的是文件，JSON 映射不需要额外依赖。

**挂载 bash 与完整编码 spine。** 第一刀否决：仅文件生成即可在零子进程成本下证明占用、擦除与 HTTP 路径。在接受 token 上限与隔离之后，bash 可以作为组合变更加回来。

**在 `Dockerfile.web` 中从 npm 安装已发布的 `@deepseek-ai/dsh`。** 否决用于 Envon web 镜像：该版本不含 `workspace-source-git` 或 `workspace.createGit`。镜像从本仓库构建 `@deepseek-ai/dsh`（`pnpm --filter @deepseek-ai/dsh deploy`），再复制 CoreNet overlay。

**在线上 Envon 组合中挂载 `principal-hmac`。** 本镜像否决：操作者 `GENERATE_TOKEN` 没有 launch cookie，认证器会让 `listVisible` 变空。线上仍用 `launch-token.mjs` 的 overlay HMAC 与 `workspace.create({ path })` 钉住工作区。hosted principal 是以后的 patch。

## Consequences

调用方（CoreNet `AiBuildController`、Hosting `EnvonAiSiteBuilder`）可以 POST prompt 并收到文件，而不必让 dsh 了解 SWA、Caddy 或 GitHub。CI 可以在没有 `DEEPSEEK_API_KEY` 或 Azure 的情况下完整行使该路径。该 POC 不能在同一进程中保护两个互不信任的客户；生产隔离仍是以后的 provider 替换。若组合把 adapter 指向付费端点且不用 session 上限，现场模型花费仍可能失控 — 这些上限是本包拥有的成本控制。

Envon Container App `ca-envon-generate-poc`（`examples/hosted-generate/azure/Dockerfile.web`，仓库根目录为构建上下文）在该代理之后提供从本仓库源码构建的 `dsh web`，以及 `/generate` 与 `/sessions/` 上的 generate HTTP 约定。`workspace-github.mjs` 把 CoreNet GitHub grant 克隆到 `/workspace`，再用 `workspace.create({ path })` 钉住。`generate-server.mjs` 还提供 `/corenet/publish` 与 `/corenet/database`（`corenet-bridge.mjs`）。Generate 以仅文件系统工具（`generate.patch.yml`）运行 `dsh --profile headless`。默认模型是 Grok，经 `llm-bridge.mjs`：设置 `FOUNDRY_API_KEY` 时走 Foundry 部署 `grok-4-3`（CAE VNet 私有 PE），否则用 `XAI_API_KEY` 走 `https://api.x.ai/v1`。默认 `--trusted-host` 为 `harness.cloudoi.io`。线上组合不挂载 `principal-hmac`。扩缩容仍为 `minReplicas=0` / `maxReplicas=1`。无密钥 generate mock（`Dockerfile` + `server.mjs`）不变。generate 产物仍由 CoreNet 写 GitHub；web overlay 也会把用户的 grant 克隆为 cwd。
