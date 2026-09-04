# Agent Note: Hosted principal, checkout isolation, Git RPC, and quotas

Status: implemented

[English](2026-09-03-hosted-principal-isolation.md) | 中文

## Problem

公开 Git Web IDE 架构的第 5–10 项（产品认证、按用户隔离、Git 同步宿主 API、IDE 界面、持久授权/审计、配额）叠在 [git workspace-source 缝](2026-09-03-git-workspace-source.zh.md) 上，但没有调用方身份。同进程 Host RPC 没有请求作用域的 tenant/user，`createGit` 信任客户端的 `checkoutParent`，git status/commit/push/pull 只存在于缝上，也没有 kill switch 或每用户上限。CoreNet 叠加层 HMAC cookie（`harness_launch`，声明 `tid,uid,product,exp`）以及 `workspace.create({ path })` 钉住路径必须继续有效。OSS `dsh web` 必须保持未认证的目录选择器。

## Decision

`ctx.principal`（`dsh-principal`）是可选 Service Definition：认证器按 id 注册，`bindFromRequest` 识别调用方，`run` 用 `AsyncLocalStorage` 为一次 Host 请求绑定该调用方。默认 `dsh web` 不挂载它。Host HTTP 载体（`dsh-client-connection`）在每次 RPC Fetch 外包 `bindFromRequest` 和 `run`，并在 `auth.logout` 上复制认证器的 `Set-Cookie`；Typert Remote 看不到 Request。`dsh-principal-hmac` 在 dsh 内再校验 CoreNet 启动令牌（cookie `harness_launch` 或 `Authorization: Bearer`）；叠加层代理在 `packages/experimental/hosted-generate/example/azure/launch-token.mjs` 中保留自己的 HMAC，不被改写。`auth.me` / `auth.logout` 是 Workspace-controller 的 Host Remote（`auth` 命名空间）。登出发出 `Set-Cookie` Max-Age=0；过期看 `exp`；本切片没有吊销列表。

注册了认证器时，workspace 记录盖上可选的 `owner: { tenantId, userId }`（领域版本保持 3，现有 Envon 单元继续加载）。Host RPC 使用 `listVisible` / `getVisible`：其他租户的 id 看起来像 not-found。OSS（无认证器）仍列出全部记录，`create({ path })` 不变。

已认证的 `createGit` 忽略客户端 `checkoutParent`，检出到 `hostedLimits.checkoutRoot/<tenantId>/<userId>/<owner>-<repo>`。没有认证器时，`checkoutParent` 仍必填。本切片没有容器隔离。

`workspace.gitStatus` / `gitCommit` / `gitPush` / `gitPull` / `gitCheckoutBranch` 是覆盖现有 git 提供者的 Workspace Remote。`dsh-hosted-limits` 提供 `killSwitch`、每用户工作区与在线会话上限（`0` = 不限制）、进程内 git 操作速率限制，以及 `checkoutRoot`。未挂载的组合没有配额。

持久化：workspace owner 在记录上；会话日志、设置和凭据仍走既有缝；git 检出仍可丢弃。本切片没有专用审计表和 GitHub 授权表；配额/认证拒绝表现为 Host RPC 错误。文件树、编辑器标签、diff、终端、预览、搜索和 SCM UI 仍是后续 IDE 工作。agent-loop 不变：它仍接收已解析的本地 cwd。

## Alternatives considered

- **在 dsh 内信任叠加层转发的 `tid`/`uid` 头。** 否决：Host 再校验 HMAC，这样配置错误的代理无法伪造身份。
- **默认 `dsh web` 就要求 principal。** 否决：OSS 是本地目录选择器；认证器是托管补丁。
- **绑定 principal 时仍尊重客户端 `checkoutParent`。** 否决：那会逃出按用户检出根目录。
- **对其他租户的 workspace id 返回 `forbidden`。** 本切片否决：`getVisible` 返回 `undefined`，Host RPC 保持 `workspace-not-found`，不确认该 id 存在。
- **本切片就做共享持久审计领域。** 否决：记录上的 owner 加上 Host 错误码是第一批持久/可观察记录；专用审计表可以再等。

## Consequences

挂载 `principal` + `principal-hmac` + `hosted-limits` 的托管补丁会隔离 git 检出，并按 owner 过滤 workspace RPC。未挂载的组合保持本地路径行为，包括 CoreNet 的 `create({ path })` 钉住。记录上的可选 `owner` 与领域版本 3 向后兼容。GitHub OAuth、服务端吊销、容器隔离、专用审计/授权以及 IDE 界面仍是后续工作。
