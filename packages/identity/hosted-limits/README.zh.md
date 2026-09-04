# @deepseek-ai/dsh-hosted-limits

[English](README.md) | 中文

DeepSeek Harness 的托管多租户策略（`ctx.hostedLimits`）：部署级 kill switch、每用户工作区与在线会话上限、进程内 git 操作速率限制，以及用于隔离 git 工作副本的绝对 `checkoutRoot`（`checkoutRoot/<tenantId>/<userId>/<owner>-<repo>`）。数值上限把 `0` 视为不限制。默认 `dsh web` 不挂载此服务。决策记录：[hosted principal Agent Note](../../../.agents/notes/implemented/architecture/2026-09-03-hosted-principal-isolation.zh.md)。

## 配置

- `killSwitch`（默认 `false`）— 变更类 workspace、session.create 与 git RPC 以 `kill-switch` 失败。
- `checkoutRoot` — 绝对目录；当已挂载 principal 认证器且 `createGit` 省略 `checkoutParent` 时必填。
- `maxWorkspacesPerUser`（默认 `0`）— 每个 tenant+user 的持久 workspace 记录数。
- `maxConcurrentSessionsPerUser`（默认 `0`）— 挂在该所有者工作区上的在线会话数。
- `maxGitOpsPerMinute`（默认 `0`）— 每用户每滚动分钟的 status/commit/push/pull/branch 次数（进程内）。

相对路径的 `checkoutRoot` 或负上限在加载时失败。

## 模型体验

### 请求上下文与条件

#### 模型看到什么

无。限额是宿主侧策略。

#### Token 影响

每次请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：此包绝不触及请求前缀，因此不会使提供方缓存复用失效。

## 已知限制与暂缓事项

- git 速率限制是进程内存；多个 Host 进程不共享计数器。
- 本切片没有按用户容器隔离，只有检出目录隔离。
- 本包没有专用持久审计记录；拒绝表现为宿主 RPC 错误与进程日志。
