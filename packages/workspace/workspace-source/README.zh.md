# @deepseek-ai/dsh-workspace-source

[English](README.md) | 中文

DeepSeek Harness 的 workspace 源能力（`ctx.workspaceSource`）：按 kind 分发的注册表，用于规范化检出请求并物化为本地 cwd。本地目录与 Git 远程作为提供者注册；消费方绝不导入提供者包。持久 spec 从不存储令牌。决策记录：[git workspace-source Agent Note](../../../.agents/notes/implemented/architecture/2026-09-03-git-workspace-source.zh.md)。

## 结构

- `ctx.workspaceSource.register(provider)`：注册一个 `kind`。重复 kind 抛出 `WORKSPACE_SOURCE_DUPLICATE_KIND`。处置器在 fiber 销毁时注销。
- `resolve(request)`：按 `request.kind` 分发，返回持久 spec（`local` 路径，或 `git` 远程身份加 `checkoutPath`）。
- `prepare(spec)`：物化或刷新工作副本，并返回供 `SessionHeader.cwd` 使用的 `{ cwd, spec }`。
- `status` / `commit` / `push` / `pull` / `checkoutBranch`：仅 git 操作；缺少 git 提供者或非 git spec 抛出 `WORKSPACE_SOURCE_UNKNOWN_KIND` 或 `WORKSPACE_SOURCE_NOT_GIT`。

未注册的 kind 在调用时失败，而不是在加载时失败。

## 模型体验

### 请求上下文与条件

#### 模型看到什么

无。`ctx.workspaceSource` 只为宿主侧检出准备服务：本包不注册工具、不注入提示词、不写入会话事件。

#### Token 影响

每次请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：此包绝不触及请求前缀，因此不会使提供方缓存复用失效。

## 已知限制与暂缓事项

- spec 上存储的 `credentialId` 尚未用于查找凭据；克隆使用进程的 Git 环境。
- 状态／提交／推送／拉取／分支的宿主 RPC 是 `dsh-host-apiproxy` 上的 `workspace.git*`；源代码管理 UI 属于后续阶段。
