# Workspaces

English | [中文](workspace.zh.md)

A workspace is the persistent record of a directory the user works in: a stable id over a canonical path, a discriminated checkout origin, a display title, and the ordered account of sessions that belong to it. The registry is [dsh-workspace](../../packages/workspace/workspace) (`ctx.workspaceRegistry`); checkout origins are the [workspace-source seam](../../packages/workspace/workspace-source) (`ctx.workspaceSource`) with local and git providers. The subsystem is an optional host-side capability, not part of the agent-loop spine, and invisible to models (no tools, no prompt text, no session events). It stores its records through the [storage domain form](storage.md) and validates session membership against [`SessionHeader.cwd`](persistence.md#sessionheader--metadata-beside-the-log), so `storageDomain` and `sessionPersistence` are mandatory startup dependencies: an unavailable persistence peer leaves the plugin pending rather than being mistaken for an empty history. Design record: [domain KV storage Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md); git origins: [git workspace-source Agent Note](../../.agents/notes/implemented/architecture/2026-09-03-git-workspace-source.md); bootstrap and GUI ordering: [Workspace UI product-flow Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md).

Source: [`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## Identity

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId` is a [branded id](core.md#branded-ids). Path identity is separate: `realpathNormalize` (`fs.realpath`; trailing slashes, `..`, and symlinks resolved) is the one uniqueness canon — workspace paths are stored canonicalized, uniqueness is string equality of canonical paths (a symlink to an owned directory collides), and attach-time session cwd checks go through the same canon.

```ts type-equiv
/**
 * Durable workspace `source` field and the spec {@link import('./index.ts').WorkspaceSource.prepare}
 * accepts. Identical on purpose: the registry stores the resolved spec.
 */
type WorkspaceSourceRecord = LocalWorkspaceSource | GitWorkspaceSource
```

`source` is required on domain v4 records. Local is `{ kind: 'local', path }`. Git is `{ kind: 'git', provider, owner, repo, branch, remoteUrl, checkoutPath, credentialId? }` and never includes a token. Optional `owner: { tenantId, userId }` is stamped when `ctx.principal` has authenticators.

## The workspace entity

Consumers see only the `Workspace` interface; the implementation stays package-private.

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

Ownership truth is the record's ordered `sessionIds`, never derived from session cwd — but membership requires both: an id on the account and a header whose canonical cwd equals the workspace path, so one session structurally belongs to at most one workspace. Failed writes reject (`insertSessionBefore` account errors as `WorkspaceMoveInvalidError`, storage failures as plain errors); every accepted mutation stamps `updatedAt` and durably prunes candidates that no longer pass the membership check.

## The registry: `ctx.workspaceRegistry`

`WorkspaceRegistry` ([signatures](#ctxworkspaceregistry--workspaceregistry)) owns registration and resolution. `create(path, title?)` canonicalizes the path, rejects a nonexistent path (the original `ENOENT`) or a non-directory, writes `{ kind: 'local', path }` as `source`, returns the existing entity unchanged when the canonical path is already owned, and otherwise creates a record with `title ?? basename(path)` prepended to the durable registry order. `createGit({ remoteUrl, checkoutParent?, ... })` requires `ctx.workspaceSource`, prepares the checkout, and writes a git `source` that never includes a token. When principal authenticators are mounted, `checkoutParent` is ignored and the parent is `hostedLimits.checkoutRoot/<tenantId>/<userId>`. `get(id)` and the ordered `list()` are synchronous cache reads; Host RPC uses `listVisible`/`getVisible` so an authenticated caller never sees another tenant's records. `resolveByPath(path)` applies the same realpath canon without creating. `delete(id)` removes only the registration, order entry, and session account — the directory, user files, live sessions, and persisted logs are never touched, so those sessions become Ungrouped ([decision](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)); unknown ids return `false`. Create and delete persist a pending-mutation marker before their two writes (record + order) can diverge; startup resolves exactly the marked mutation — by deleting the marked table row, which completes an interrupted delete and rolls back an interrupted create (the registration is re-creatable, so rollback is the safe direction) — and an unmarked order/table mismatch fails loud as corruption. Domain version is 4: a stored unit at version 3 is `version-mismatch`.

Sessions get their cwd at create time from whoever creates them, not from this registry — the API gateway asks `ctx.workspaceSource.prepare(workspace.source)` when the seam is mounted (clone/fetch for git, realpath for local), falls back to `workspace.path` for local records when the seam is absent so `workspace.create({ path })` overlays stay valid, creates the session so the cwd lands in its immutable [`SessionHeader`](persistence.md#sessionheader--metadata-beside-the-log), then calls `attachSession`, which re-validates that stored header cwd against the workspace path. On the first successful start, the registry bootstraps history from persisted headers alone (`id`, `cwd`, `createdAt` — never event bodies), grouping sessions with a valid canonical cwd into per-directory workspaces with `{ kind: 'local', path }`, newest first; the initialized marker is written last so an interrupted bootstrap resumes safely. The bootstrap is one-time: cwd-less legacy sessions stay Ungrouped, and sessions created afterwards join a workspace only through `attachSession`.

## Consumers

[dsh-host-apiproxy](../../packages/host/apiproxy) is the product consumer: it serves workspace CRUD to GUI clients over `ctx.workspaceRegistry` and performs the create-session-then-attach flow above. [dsh-agent-instructions](../../packages/context/agent-instructions) is **not** a consumer despite the name: it discovers AGENTS.md-style instruction files under an agent's own cwd and never touches `ctx.workspaceRegistry` — the shared word refers to the user's working directory, not to this registry's entities.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.md)

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
