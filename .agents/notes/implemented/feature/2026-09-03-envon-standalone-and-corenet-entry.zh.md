# Agent Note: Envon standalone Git IDE beside CoreNet login

Status: implemented

[English](2026-09-03-envon-standalone-and-corenet-entry.md) | 中文

## Problem

公开 Git Web IDE（git workspace-source、`createGit`、Host git RPC、可选 principal 隔离）应能作为 `harness.cloudoi.io` 上的 DeepSeek Harness 运行，而不要求每位访问者都经过 CoreNet。Envon overlay 仍需要 CoreNet HMAC launch（`/?launch=` 与 cookie `harness_launch` 上的 `tid,uid,product,exp`），以便 CloudOI 账号通过 `workspace.create({ path })` 固定其 GitHub 授权。只要设置了 `HARNESS_CORENET_ORIGIN`，未认证 GET `/` 就会 302 到 `HARNESS_CORENET_ORIGIN/app/harness-launch`，因此 GENERATE_TOKEN 无法在浏览器中呈现 Git IDE，`createGit` 也离不开 app.cloudoi.io。

## Decision

`packages/experimental/hosted-generate/example/azure/web-proxy.mjs` 保留 HMAC `/?launch=` 固定、cookie，以及对 `/workspace` 的 `workspace.create`。未认证 HTML GET `/` 返回落地页，提供 CloudOI 登录，并在设置了 `GENERATE_TOKEN` 或未设置 launch HMAC 时提供 Git IDE（`/`）和 `/clone`。非 HTML 未认证请求仍 401，并要求 Basic/Bearer。GENERATE_TOKEN 的 GET `/` 转发到 loopback `dsh web`，不固定 `/workspace`。已认证 `POST /clone` `{ remoteUrl }`（JSON 或表单）调用 dsh `workspace/createGit`，`checkoutParent=/workspace`（线上组合不挂载 principal-hmac）。`/new` 仍 302 到 `/`。默认 web 仍不挂载 `principal-hmac`。

`grok.patch.yml` 中的 Grok persona 跟随 `.cloudoi/CORENET.md`：仅当该文件存在时才使用 CoreNet publish/database 命令。

## Alternatives considered

**保留未认证 302 到 CoreNet。** 否决：这会让 GENERATE_TOKEN 和 `createGit` 无法从 `harness.cloudoi.io` 的浏览器到达。

**在线上 Envon 挂载 `principal-hmac`，使独立 `createGit` 省略 `checkoutParent`。** 本切片否决：GENERATE_TOKEN 没有 launch cookie，`listVisible` 会变成空列表。

**在 harness.cloudoi.io 上做 GitHub OAuth。** 推迟。在产品 OAuth 出现之前，GENERATE_TOKEN 是独立入口。

## Consequences

CloudOI 用户仍通过 `app.cloudoi.io`（`/?launch=`）打开 Envon。不带 launch cookie 访问 `https://harness.cloudoi.io/` 会看到落地页，而不是被送到 CoreNet。持有 GENERATE_TOKEN 的操作者可以进入 `dsh web`，并克隆公开的 GitHub https URL。隔离仍是单进程；CoreNet 与 GENERATE_TOKEN 共用副本。没有 CoreNet 授权的私有克隆仍是后续工作。

## Testing

`packages/experimental/hosted-generate/tests/web-proxy.spec.ts` 覆盖无 CoreNet `Location` 的 HTML 落地页、无 `Location` 的 JSON 401，以及 GENERATE_TOKEN 在不固定工作区时的转发。`workspace-github.spec.ts` 覆盖 `parseGithubHttpsRemote`（URL 中不含凭据）以及 `workspace/createGit` 参数 `{ request: { remoteUrl, checkoutParent } }`。

## Related

[Envon GitHub cwd](2026-08-29-envon-github-cwd.zh.md) 仍拥有 HMAC 克隆进 `/workspace` 以及 `/new` → `/`。[Hosted generate POC](2026-08-28-hosted-generate-poc.zh.md) 仍拥有 generate 占用。[Hosted principal isolation](../architecture/2026-09-03-hosted-principal-isolation.zh.md) 仍拥有线上 Envon 不挂载 `principal-hmac` 的原因。
