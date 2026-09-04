# Agent Note: Git workspace sources prepare local checkouts

Status: implemented

[English](2026-09-03-git-workspace-source.md) | 中文

## Problem

Web 宿主需要从 Git 打开用户项目，同时不让浏览器或模型直接拥有宿主文件系统权限。既有工作区注册表把已经存在的本地目录同时当作获取方式与会话 cwd，因此公共 IDE 只能在产品专属启动代码中 clone 仓库，再把每个 checkout 伪装成本地工作区。

只放在启动脚本里的设计没有持久所有者来记录仓库 URL、分支、checkout 路径或凭据引用。会话创建可以恢复已存 cwd，但不能刷新 checkout，也不能在缺少源提供者时拒绝 Git 工作区。

## Decision

工作区子系统在每个工作区的规范 `path` 旁存储 `source` 记录。Local 记录命名一个已有宿主目录。Git 记录命名 provider、owner、repo、branch、remote URL、checkout path，以及可选 `credentialId`；持久记录从不存储令牌。

`ctx.workspaceSource` 是工作区获取的提供者注册表。`resolve` 在没有网络或文件系统 effect 的情况下填满持久 source spec，`prepare` 执行 I/O 并返回会话使用的规范 cwd。`dsh-workspace-source-local` 准备已有目录，`dsh-workspace-source-git` 通过进程 Git 环境 clone 或 fetch GitHub 仓库。

`workspaceRegistry.createGit` 在写入工作区记录之前解析并准备 Git source，然后复用任何规范 cwd 与 checkout 匹配的既有工作区。已挂载 `ctx.workspaceSource` 时，`session.create({ workspaceId })` 在创建 agent 之前准备已存 source；没有该服务时，local 记录使用已存路径，Git 记录会拒绝。

web-app bundle 挂载 dispatcher 以及 local 和 Git 提供者，因此浏览器客户端可以通过 Workspace Remote namespace 调用 `workspace.createGit`。客户端 service 与 model 暴露同名 `createGit` 动词，workspace feed 携带已存 source 投影。

## Testing

聚焦测试覆盖提供者分发、本地规范化、Git URL 解析、clone/fetch/status 操作、`workspaceRegistry.createGit`、Remote 幂等性、客户端投影、测试运行时 fake，以及基于 workspace source 的会话创建。本分支还通过 `pnpm run typecheck`、`pnpm run test:docs`，以及用于此变更的聚焦 workspace/session Vitest 集合。

## Alternatives considered

**让 Git 取代工作区注册表。** Git-only 注册表会让公共 Web 场景更直接，但会破坏本地目录工作区，并迫使每个既有工作区消费者理解仓库元数据。把 Git 保持为 source 能保留稳定的工作区 id 与 cwd 模型。

**继续在产品启动脚本里 clone 仓库。** 这符合 hosted-generate proof of concept，但核心注册表只会看到 `/workspace`，因此无法记住 origin、branch 或 credential identity。把 origin 数据移入 `WorkspaceRecord.source` 后，会话创建与浏览器 API 都拥有一条自有 Git 路径。

**在工作区记录中存储 Git token。** 持久 token 会让 clone 不依赖进程环境，但会把凭据放入工作区表和临近会话的投影中。记录只存储 `credentialId`；凭据查找与 Git 环境设置仍由提供者或宿主负责。

## Consequences

agent loop、文件系统工具、shell 与 LSP provider 仍接收普通本地 cwd，因此 Git-backed 工作区不需要重写远程文件系统。公共 Web IDE 可以把用户 GitHub 仓库映射到隔离 checkout parent，并通过工作区 id 打开会话。

Checkout 隔离、凭据物化与租户策略仍是提供者周围的宿主职责。source-control status、commit、push、pull 与分支切换是提供者操作；UI 或 Remote controller 可以包装这些操作，而无需改变工作区创建。
