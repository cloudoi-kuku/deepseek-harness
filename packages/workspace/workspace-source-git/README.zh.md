# @deepseek-ai/dsh-workspace-source-git

[English](README.md) | 中文

`ctx.workspaceSource` 的 Git 检出提供者（`kind: 'git'`）。`resolve` 把克隆 URL 解析为 `{ provider, owner, repo, branch, remoteUrl, checkoutPath }`，检出目录为 `checkoutParent/${owner}-${repo}`，并且从不存储令牌。`prepare` 在目标不存在时 clone；否则 fetch、检出记录的分支并快进 pull。`ctx.workspaceSource` 上提供 status、commit、push、pull 与分支切换。

配置：`operationTimeoutMs`（默认 `120000`）限制 clone/fetch/push/pull。

## 模型体验

### 请求上下文与条件

#### 模型看到什么

无。此提供者注册进 `ctx.workspaceSource`，不贡献工具、提示词或会话事件。

#### Token 影响

每次请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：此包绝不触及请求前缀，因此不会使提供方缓存复用失效。

## 已知限制与暂缓事项

- spec 上记录的 `credentialId` 尚未使用；Git 使用进程环境（`GIT_TERMINAL_PROMPT=0`）。
- pull 只允许快进。上游已分叉时 `prepare` 失败，而不是合并。
- 源代码管理 UI 属于后续阶段；宿主 RPC 为 `workspace.gitStatus` / `gitCommit` / `gitPush` / `gitPull` / `gitCheckoutBranch`。
