# workspace/：workspace 实体家族

[English](README.md) | 中文

本家族拥有持久 workspace：带标题、可区分检出源、可选 principal 所有权以及有序会话成员关系的用户目录。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`workspace/`](workspace/README.zh.md) | 注册 workspace 并记录其会话归属 | `ctx.workspaceRegistry` |
| [`workspace-source/`](workspace-source/README.zh.md) | 按 kind 分发的检出源 resolve/prepare 注册表 | `ctx.workspaceSource` |
| [`workspace-source-local/`](workspace-source-local/README.zh.md) | 已有目录提供者（`kind: 'local'`） | 注册进 `ctx.workspaceSource` |
| [`workspace-source-git/`](workspace-source-git/README.zh.md) | Git clone/fetch/status/commit/push/pull 提供者（`kind: 'git'`） | 注册进 `ctx.workspaceSource` |

[workspace 包参考](workspace/README.zh.md)负责生命周期、持久化和删除语义。

子系统参考——实体、realpath 规范、注册/解析——见 [docs/subsystems/workspace.md](../../docs/subsystems/workspace.zh.md)；存储设计见 [domain KV 存储 Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)。
