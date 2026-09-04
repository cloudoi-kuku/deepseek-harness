# Agent Note: Envon Harness GitHub workspace at dsh web `/`

Status: implemented

[English](2026-08-29-envon-github-cwd.md) | 中文

## Problem

Envon Harness 就是 DeepSeek Harness：客户产品是 `/` 上的 `dsh web`，不是一次性 generate 表单。Session `meta.cwd` 是绝对本地路径。CoreNet 用户带着 launch HMAC 和 GitHub 账号到达，而不是笔记本上的文件夹。GitHub token 不得出现在 `/?launch=` 里（Referer、历史、访问日志）。dsh 不得写 DNS 或部署；`{slug}.cloudoi.dev` 仍由 CoreNet 拥有。已发布的 `dsh@0.1.1-rc.2` 没有 GitHub/GCS/OneDrive 工作区 provider。

## Decision

CoreNet `CreateHarnessLaunch` 签发 `{HarnessPublicUrl}/?launch={hmac}`。Envon `web-proxy.mjs` 校验该 token，然后以同一 token 作为 Bearer 调用 `GET /api/ai-build/from-harness/workspace`。CoreNet 使用已存储的 GitHub OAuth token（不是 CoreNet JWT）为该 GitHub 用户确保私有仓库 `cloudoi-harness`，在空仓库时写入 `README.md`，并返回 `{kind,owner,name,cloneUrl,token,defaultBranch}`。Envon 把该树克隆到 `/workspace`（`entrypoint.sh` 启动的 `dsh --profile web` 的 cwd），把 token 写入 `~/.git-credentials`（权限 0600），并定时 `git push` 脏文件。克隆之后，Envon 对 `/workspace` POST dsh `workspace.create`（路径 `/api/workspace.create`，即已发布的 `0.1.1-rc.2` apiproxy），标题为 `owner/name`，这样 web 输入框即可使用，不必再选目录。带 launch cookie 的 GET `/` 会重新挂载并重新注册，因此副本回收后仍跳过目录选择器。`/new` 302 到 `/`。`POST /generate` 仍是 CoreNet 向导使用的无头文件映射路径。隔离仍是一个进程、一个 `/workspace`。

GitHub token 不出现在 launch 查询字符串中。launch HMAC 在 10 分钟过期前可重复使用（Envon cookie 与 CoreNet `from-harness/*` 共用）；其中不含 email。dsh 仍不访问 SWA、Caddy 或 DNS。

## Alternatives considered

**把 GitHub token 放进 launch 查询字符串。** 否决：浏览器和代理会把查询字符串复制进 Referer、历史和访问日志。HMAC launch token 只负责账号接合；克隆授权是另一次已认证 GET。

**把 `/new` 当作客户首页。** 否决：Envon Harness 是完整的 `dsh web` UI。generate HTML 表单不是该产品。`/new` 重定向到 `/`。

**在 `dsh-workspace` 内交付 `local|github|gcs|onedrive` provider，并采用 `resolve(request) → spec`。** 推迟。本切片把 GitHub 落成本地目录，以便已发布 CLI 的 cwd 约定在没有新 OSS 包、也没有超过 `0.1.1-rc.2` 的 npm 发布时仍然成立。GCS、OneDrive 与 Hosting 站点树等待该能力。

**签发一小时有效的 GitHub App installation token。** 推迟。CoreNet 已经存储用户的 OAuth token；短时克隆凭证是下一步收紧，不是第一条附着路径的阻塞项。

## Consequences

已连接 GitHub 的 CoreNet 用户打开 `https://harness.cloudoi.io/?launch=…` 会进入 `dsh web`，工作区已经是该 GitHub 树（`owner/cloudoi-harness`），可以直接输入。一个副本仍只有一个 cwd，因此重叠的 launch 会共用 `/workspace`。GitHub OAuth token 可被 Envon 进程和 git 读取；调用方不得记录 `HarnessWorkspaceResponse.Token`。Hosting 未改（不会签发 `product: hosting`）。原生工作区 provider 仍是后续工作；本笔记不声称它们已交付。

## Testing

`HarnessWorkspaceTests` 覆盖 launch URL 为 `/?launch=`（不是 `/new`）、404 时创建、复用且不补种、以及缺少 GitHub token。`packages/experimental/hosted-generate/tests/workspace-github.spec.ts` 覆盖 grant JSON 解析、不含 token 的 clone URL、Bearer 拉取、stderr 脱敏、dsh `workspace.create` RPC 信封、重命名为 `owner/name`、dsh 未就绪时的重试，以及业务 RPC 错误时立即失败。

## Related

[Hosted generate POC](2026-08-28-hosted-generate-poc.zh.md) 仍拥有 generate 占用、成本上限，以及 generate/deploy 拆分。[独立 Git IDE 与 CoreNet 并存](2026-09-03-envon-standalone-and-corenet-entry.zh.md) 拥有未认证落地页、GENERATE_TOKEN `dsh web` 和 `/clone`。CoreNet 路径见 CoreNet 仓库中的 `docs/envon-harness-corenet-path.md`。
