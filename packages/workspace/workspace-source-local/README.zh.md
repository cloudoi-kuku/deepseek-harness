# @deepseek-ai/dsh-workspace-source-local

[English](README.md) | 中文

`ctx.workspaceSource` 的本地目录提供者（`kind: 'local'`）。通过 `fs.realpath` 规范化已有目录；`prepare` 是同一检查。缺失或非目录路径抛出 `WORKSPACE_SOURCE_INVALID_REQUEST`。

## 模型体验

### 请求上下文与条件

#### 模型看到什么

无。此提供者注册进 `ctx.workspaceSource`，不贡献工具、提示词或会话事件。

#### Token 影响

每次请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：此包绝不触及请求前缀，因此不会使提供方缓存复用失效。

## 已知限制与暂缓事项

- 此提供者不创建目录；`workspace.create({ path })` 仍要求路径已存在，与注册表一致。
