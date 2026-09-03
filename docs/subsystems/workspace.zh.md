# 工作区

[English](workspace.md) | 中文

工作区（workspace）是用户工作目录的持久记录：一个建立在规范路径之上的稳定 id、一个可区分的检出源、一个显示标题，以及归属于它的会话的有序账本。注册表是 [dsh-workspace](../../packages/workspace/workspace)（`ctx.workspaceRegistry`）；检出源是 [workspace-source 能力缝](../../packages/workspace/workspace-source)（`ctx.workspaceSource`）及其 local / git 提供者。该子系统是一项宿主侧可选能力，不属于 agent loop（智能体循环）主干，并且对模型不可见（没有工具、没有提示词文本、没有会话事件）。它通过[存储领域数据形式](storage.zh.md)存储自己的记录，并对照 [`SessionHeader.cwd`](persistence.zh.md#sessionheader--metadata-beside-the-log) 校验会话成员资格，因此 `storageDomain` 与 `sessionPersistence` 是必需的启动依赖：持久化这一依赖不可用时，插件保持 pending，而不是把这种不可用误当作空历史。设计记录：[领域 KV 存储 Agent Note（agent 决策记录）](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)；Git 源：[git workspace-source Agent Note](../../.agents/notes/implemented/architecture/2026-09-03-git-workspace-source.zh.md)；引导与 GUI 顺序：[Workspace UI 产品流程 Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.zh.md)。

源码：[`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## 标识

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId` 是[品牌化 id](core.zh.md#branded-ids)。路径标识与之分离：`realpathNormalize`（`fs.realpath`；尾部斜杠、`..` 与符号链接全部解析）是唯一的一套唯一性规范——工作区路径以规范化形式存储，唯一性即规范路径的字符串相等（指向已被拥有目录的符号链接会与之冲突），attach 时的会话 cwd 检查也走同一套规范。

```ts type-equiv
/**
 * Durable workspace `source` field and the spec {@link import('./index.ts').WorkspaceSource.prepare}
 * accepts. Identical on purpose: the registry stores the resolved spec.
 */
type WorkspaceSourceRecord = LocalWorkspaceSource | GitWorkspaceSource
```

领域版本 4 的记录必须有 `source`。local 为 `{ kind: 'local', path }`。git 为 `{ kind: 'git', provider, owner, repo, branch, remoteUrl, checkoutPath, credentialId? }`，且从不包含令牌。在 `ctx.principal` 已有认证器时会盖上可选的 `owner: { tenantId, userId }`。

## 工作区实体

消费方只看到 `Workspace` 接口；实现保持包内私有。

```ts type-equiv
/**
 * One workspace: a stable id over an existing directory, a display title, a
 * discriminated checkout origin, and an ordered candidate account of sessions.
 * Membership requires both an id in that account and a session header whose
 * canonical cwd equals the workspace path. Consumers only see this interface;
 * the implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Tenant+user that created the record when `ctx.principal` had authenticators.
   * Omitted for OSS/local and history-bootstrap workspaces.
   */
  readonly owner?: WorkspaceOwner | undefined

  /**
   * Discriminated checkout origin. Local records store `{ kind: 'local', path }`;
   * git records store remote identity and `checkoutPath`. Tokens are never stored.
   */
  readonly source: WorkspaceSourceRecord

  /**
   * Canonical directory path: the `fs.realpath` of the path given at create
   * time (trailing slashes, `..`, and symlinks all resolved). Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string

  /** Display title. Defaults to `basename(path)` at create; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * live or persisted
   * header cwd must resolve to an existing directory equal to {@link path};
   * unknown ids, missing or invalid cwd values, and mismatches reject without
   * writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

所有权的真源是记录中有序的 `sessionIds`，绝不从会话 cwd 派生——但成员资格要求两者同时成立：账本上有其 id，且 header 的规范 cwd 等于工作区路径，因此一个会话在结构上至多属于一个工作区。失败的写入会拒绝（`insertSessionBefore` 的账本错误以 `WorkspaceMoveInvalidError` 拒绝，存储失败以普通错误拒绝）；每次被接受的变更都盖上 `updatedAt` 时间戳，并持久修剪不再通过成员资格检查的候选项。

## 注册表：`ctx.workspaceRegistry`

`WorkspaceRegistry`（[签名](#ctxworkspaceregistry--workspaceregistry)）拥有注册与解析。`create(path, title?)` 规范化路径，拒绝不存在的路径（原样传出原始 `ENOENT`）或非目录，写入 `{ kind: 'local', path }` 作为 `source`；当规范路径已被拥有时原样返回既有实体；否则创建一条标题为 `title ?? basename(path)` 的记录并前插到持久的注册表顺序中。`createGit({ remoteUrl, checkoutParent?, ... })` 需要 `ctx.workspaceSource`，先准备检出，再写入不含令牌的 git `source`。当已挂载 principal 认证器时，忽略 `checkoutParent`，父目录为 `hostedLimits.checkoutRoot/<tenantId>/<userId>`。`get(id)` 与有序的 `list()` 是同步缓存读取；宿主 RPC 使用 `listVisible`/`getVisible`，已认证调用方看不到其他租户的记录。`resolveByPath(path)` 应用同一套 realpath 规范但不创建。`delete(id)` 只移除注册记录、顺序条目和会话账本——目录、用户文件、实时会话和已持久化日志一概不动，因此这些会话变为 Ungrouped（[决策](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.zh.md)）；未知 id 返回 `false`。create 与 delete 会在其两次写入（记录 + 顺序）可能分叉之前先持久写入一个待定变更标记；启动时恰好解决被标记的那次变更——通过删除被标记的表行：这会补完被中断的 delete，并回滚被中断的 create（注册可以重建，因此回滚是安全方向）——而没有标记的顺序/表不一致则作为损坏大声失败。领域版本为 4：存储单元仍为版本 3 时是 `version-mismatch`。

会话的 cwd 在创建时由创建者赋予，而不是由本注册表赋予——API 网关在已挂载 `ctx.workspaceSource` 时调用 `prepare(workspace.source)`（git 则 clone/fetch，local 则 realpath），缝未挂载时对 local 记录回退到 `workspace.path`，从而保持 `workspace.create({ path })` 叠加层有效；先创建会话使 cwd 落入其不可变的 [`SessionHeader`](persistence.zh.md#sessionheader--metadata-beside-the-log)，再调用 `attachSession`，后者会把已存储的 header cwd 与工作区路径重新校验一遍。首次成功启动时，注册表仅凭已持久化的 header（`id`、`cwd`、`createdAt`——绝不读事件正文）引导历史：把规范 cwd 有效的会话按目录分组为带 `{ kind: 'local', path }` 的工作区，最新的排在最前；「已初始化」标记最后写入，因此被中断的引导可以安全续跑。引导只发生这一次：没有 cwd 的历史遗留会话保持 Ungrouped，此后创建的会话只能通过 `attachSession` 加入工作区。

## 消费方

[dsh-host-apiproxy](../../packages/host/apiproxy) 是产品消费方：它经 `ctx.workspaceRegistry` 向 GUI 客户端提供工作区的 CRUD，并执行上文「先建会话再 attach」的流程。[dsh-agent-instructions](../../packages/context/agent-instructions) 尽管名字如此，却**不是**消费方：它在 agent 自己的 cwd 下发现 AGENTS.md 风格的指令文件，从不触碰 `ctx.workspaceRegistry`——两者共用的这个词指的是用户的工作目录，而非本注册表的实体。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker` (abstract seam)

Abstract directory-picking service. Subclass, implement `capability()`, and load the subclass as a plugin — it registers as `ctx.directoryPicker` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). The capability object must be stable for the service lifetime: consumers may capture it across calls.

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

Source: [`packages/host/directory-picker/src/index.ts`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxhostedlimits--hostedlimits"></a>

### `ctx.hostedLimits` — `HostedLimits`

Hosted abuse and isolation policy. Default web-app does not mount this service; hosted patches do.

```ts cordis-catalog
/**
 * Reject when the deployment kill switch is on.
 */
assertNotKilled(): void

/**
 * Reject a new workspace when the per-user cap is already reached.
 * @param owner - tenant+user the new record would belong to.
 * @param existingCount - workspaces already owned by that pair.
 */
assertWorkspaceCreate(owner: LimitOwner, existingCount: number): void

/**
 * Reject a new live session when the per-user cap is already reached.
 * @param owner - tenant+user owning the workspace.
 * @param liveCount - live sessions already attached to that owner's workspaces.
 */
assertSessionCreate(owner: LimitOwner, liveCount: number): void

/**
 * Reject a git RPC when the per-minute cap is already reached. Process-local.
 * @param owner - tenant+user performing the git operation.
 */
assertGitOp(owner: LimitOwner): void

/**
 * The checkout root required for isolated git checkouts, or a loud failure.
 * @returns the absolute checkout root.
 */
requireCheckoutRoot(): string
```

Source: [`packages/identity/hosted-limits/src/index.ts`](../../packages/identity/hosted-limits/src/index.ts)

<a id="ctxprincipal--principalservice"></a>

### `ctx.principal` — `PrincipalService`

Request-scoped caller registry. Load one instance per context as `ctx.principal`; authenticators register into it. The default web-app composition does not mount this service.

```ts cordis-catalog
/**
 * Register one authenticator. A duplicate `id` throws. The disposer
 * unregisters on fiber disposal.
 * @param authenticator - implementation that reads cookies or headers.
 * @returns the disposer that unregisters the authenticator.
 */
register(authenticator: PrincipalAuthenticator): () => void

/**
 * Whether at least one authenticator is registered. Workspace ownership and
 * checkout isolation require this, not merely that the service is mounted.
 * @returns true when a caller is expected on Host requests.
 */
hasAuthenticators(): boolean

/**
 * The caller bound by the current `run` continuation.
 * @returns the bound principal, or `undefined` outside `run` / when bind found none.
 */
current(): Principal | undefined

/**
 * The bound caller, or a rejection when none is bound.
 * @param action - included in the error message.
 * @returns the bound principal.
 */
require(action: string): Principal

/**
 * Bind `principal` for the duration of `fn`. Nested `run` calls replace the
 * store for the inner continuation and restore the outer value afterwards.
 * Concurrent `run` calls do not share a store.
 * @param principal - caller to expose via {@link current}, or `undefined`.
 * @param fn - work that may read {@link current}.
 * @returns `fn`'s return value.
 */
run<T>(principal: Principal | undefined, fn: () => T): T

/**
 * Ask authenticators in registration order until one returns a principal.
 * Does not bind ALS; the HTTP carrier wraps the handler in {@link run}.
 * @param request - inbound WHATWG Request (cookies and Authorization).
 * @returns the first identified principal, or `undefined` when none matched.
 */
async bindFromRequest(request: Request): Promise<Principal | undefined>

/**
 * Collect logout side effects (typically `Set-Cookie` clearing) from every
 * authenticator. Identification is not required; clearing a missing cookie is
 * a no-op.
 * @param request - inbound request whose cookies/headers to clear.
 * @returns merged `Set-Cookie` values for the HTTP response.
 */
async logout(request: Request): Promise<PrincipalLogout>
```

Source: [`packages/identity/principal/src/index.ts`](../../packages/identity/principal/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

Durable workspace registry. Startup waits for `sessionPersistence`, builds one canonical-cwd header index, and completes the one-time history bootstrap before the service becomes active. The persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history and commit the initialized marker.

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The path is
 * canonicalized through `fs.realpath`; a nonexistent path rejects with the
 * original error and a non-directory rejects. Repeated calls for the same
 * canonical path return the existing entity without changing its title.
 * A newly created workspace is prepended to the durable registry order.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in any path spelling.
 * @param title - Display title used only when a new record is created.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string): Promise<Workspace>

/**
 * Create or reuse a workspace whose origin is a Git remote. Requires
 * `ctx.workspaceSource` with a git provider. Resolves the remote, prepares
 * (clone or fetch) the checkout, then records `{ kind: 'git', ... }` — never
 * a token. Repeated calls for the same canonical checkout path return the
 * existing entity without changing its title.
 * @param request - remote URL, checkout parent, and optional branch/title.
 * @returns the existing or newly durable workspace.
 */
async createGit(request: WorkspaceCreateGitRequest): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Look up a workspace the current principal may see. Without authenticators
 * this is {@link get}. With authenticators, an unauthenticated caller or a
 * record owned by someone else returns `undefined` (same as unknown).
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown or not visible.
 */
getVisible(id: WorkspaceId): Workspace | undefined

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * Internal consumers (bootstrap, attach) must use this unfiltered list.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Workspaces the current principal may see. Without authenticators this is
 * {@link list}. With authenticators and no bound caller, the list is empty.
 * @returns visible workspaces in durable registry order.
 */
listVisible(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The durable order is updated before the table deletion; a
 * failed table write restores the prior order and keeps the entity
 * published. Unknown ids are an idempotent no-op for domain callers.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Resolve by canonical directory path without creating or mutating a
 * workspace. A missing path rejects during `realpath`; an existing unowned
 * directory returns `undefined`.
 * @param path - Existing directory path in any spelling.
 * @returns the workspace owning the canonical path, when one exists.
 */
async resolveByPath(path: string): Promise<Workspace | undefined>

/**
 * Whether Host callers must be authenticated for workspace visibility.
 * @returns true when `ctx.principal` has at least one authenticator.
 */
authRequired(): boolean

/**
 * Count durable workspaces owned by `owner`.
 * @param owner - tenant+user pair.
 * @returns the number of matching records.
 */
ownedCount(owner: WorkspaceOwner): number

/**
 * Live sessions attached to workspaces owned by `owner`.
 * @param owner - tenant+user pair.
 * @returns the number of live sessions on those workspaces.
 */
liveSessionCount(owner: WorkspaceOwner): number
```

Types: [SessionId](core.zh.md)

Source: [`packages/workspace/workspace/src/index.ts`](../../packages/workspace/workspace/src/index.ts)

<a id="ctxworkspacesource--workspacesource"></a>

### `ctx.workspaceSource` — `WorkspaceSource`

Workspace origin registry. Load one instance per context as `ctx.workspaceSource`; providers register into it.

```ts cordis-catalog
/**
 * Register a provider for one kind. Throws
 * {@link WorkspaceSourceError} `WORKSPACE_SOURCE_DUPLICATE_KIND` when that
 * kind is already registered. The disposer unregisters on fiber disposal.
 * @param provider - implementation whose `kind` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
register(provider: WorkspaceSourceProvider): () => void

/**
 * Canonicalize a request through the provider for `request.kind`.
 * @param request - local path or git remote request.
 * @returns the durable spec; never contains a token.
 */
async resolve(request: WorkspaceSourceRequest): Promise<WorkspaceSourceSpec>

/**
 * Materialize or refresh the working copy, then return its canonical cwd.
 * @param spec - local or git spec (the durable workspace `source` field).
 * @returns the checkout the agent/session machinery uses as cwd.
 */
async prepare(spec: WorkspaceSourceSpec): Promise<WorkspaceCheckout>

/**
 * Report git working-copy status.
 * @param spec - git spec whose checkout to inspect.
 * @returns branch, dirty, ahead/behind, conflicts, and last-pushed time.
 */
async status(spec: GitWorkspaceSource): Promise<GitWorkspaceStatus>

/**
 * Stage every change and create a commit on the git checkout.
 * @param spec - git spec whose checkout to commit.
 * @param message - non-empty commit message.
 * @returns the new `HEAD` object name.
 */
async commit(spec: GitWorkspaceSource, message: string): Promise<GitCommitResult>

/**
 * Push the current branch to `origin`.
 * @param spec - git spec whose checkout to push.
 */
async push(spec: GitWorkspaceSource): Promise<void>

/**
 * Fast-forward pull the current branch.
 * @param spec - git spec whose checkout to pull.
 * @returns conflicted paths when the pull cannot complete cleanly.
 */
async pull(spec: GitWorkspaceSource): Promise<GitPullResult>

/**
 * Check out `branch` on the git working copy.
 * @param spec - git spec whose checkout to switch.
 * @param branch - branch name.
 */
async checkoutBranch(spec: GitWorkspaceSource, branch: string): Promise<void>
```

Source: [`packages/workspace/workspace-source/src/index.ts`](../../packages/workspace/workspace-source/src/index.ts)
<!-- END GENERATED cordis-surface -->
