/**
 * workspace domain contract. Wire projection of the host-side workspace
 * entity (@deepseek-ai/dsh-workspace): a stable id over a directory path,
 * a display title, and the ordered session account. Method signatures are the
 * source of truth, same as the sessions domain.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Wire-side workspace id brand. Deliberately re-declared here rather than
 * imported from dsh-workspace: api/ must stay browser-importable with zero
 * host-package dependencies, and the brand string matches, so both sides
 * agree structurally.
 */
export type WorkspaceId = Branded<'WorkspaceId'>

/** Local checkout origin on the wire. */
export interface LocalWorkspaceSourceView {
  kind: 'local'
  path: string
}

/** Git checkout origin on the wire. Tokens are never included. */
export interface GitWorkspaceSourceView {
  kind: 'git'
  provider: 'github' | 'generic'
  owner: string
  repo: string
  branch: string
  remoteUrl: string
  checkoutPath: string
  credentialId?: string | undefined
}

/** Discriminated checkout origin projected on {@link WorkspaceView}. */
export type WorkspaceSourceView = LocalWorkspaceSourceView | GitWorkspaceSourceView

/** Tenant+user stamped when the record was created under an authenticated principal. */
export interface WorkspaceOwnerView {
  tenantId: string
  userId: string
}

/** Git working-copy status projected on workspace.gitStatus. Tokens are never included. */
export interface GitWorkspaceStatusView {
  branch: string
  dirty: boolean
  ahead: number
  behind: number
  conflicted: string[]
  lastPushedAt?: string | undefined
}

/** One workspace row: the record projection every workspace.* value carries. */
export interface WorkspaceView {
  workspaceId: WorkspaceId
  /** Canonical directory path (host-side realpath canon). */
  path: string
  /** Display title (defaults to the path basename at create). */
  title: string
  /** Checkout origin; omitted only by hosts that have not yet written domain v3. */
  source?: WorkspaceSourceView
  /** Tenant+user owner; omitted on OSS/local and history-bootstrap records. */
  owner?: WorkspaceOwnerView | undefined
  /**
   * Sessions accounted under this workspace, in manually owned order
   * (attach prepends, insertSessionBefore reorders; activity never does).
   */
  sessionIds: SessionId[]
  /** ISO-8601 creation instant. */
  createdAt: string
  /** ISO-8601 last-mutation instant. */
  updatedAt: string
}

/** Workspace-domain unary methods (the map keys workspace.* of RpcMethodMap). */
export interface WorkspaceApi {
  /**
   * Lists all workspaces in the registry's durable display order, plus the
   * registry-global archive set (the reconnect baseline of
   * `host/archived-sessions-changed`). Archived sessions stay in their
   * workspace's `sessionIds` account; grouping surfaces hide them.
   */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ items: WorkspaceView[]; archivedSessionIds: SessionId[] }>>

  /**
   * Creates (or idempotently resolves) a workspace over an EXISTING directory
   * (no mkdir — a missing or non-directory path fails with
   * `workspace-invalid-path`). A path resolving to a directory already owned
   * by a workspace returns that workspace (`created: false`). Adoption allows
   * distinct canonical paths whose basenames produce the same display title;
   * the registry's basename title default names the new workspace.
   */
  create(request: RpcRequest<{ path: string }>):
  Promise<RpcResponse<{ workspace: WorkspaceView; created: boolean }>>

  /**
   * Creates (or idempotently resolves) a workspace from a Git remote. The
   * host clones or fetches into `checkoutParent/${owner}-${repo}` through
   * `ctx.workspaceSource` and records `{ kind: 'git', ... }` — never a
   * token. When principal authenticators are mounted, `checkoutParent` is
   * ignored and the parent is `hostedLimits.checkoutRoot/<tenantId>/<userId>`.
   * A composition without the source seam fails with
   * `workspace-source-unavailable`. An unparseable remote fails with
   * `workspace-invalid-remote`. Clone/fetch failures fail with
   * `workspace-prepare-failed`.
   */
  createGit(request: RpcRequest<{
    remoteUrl: string
    checkoutParent?: string
    branch?: string
    owner?: string
    repo?: string
    credentialId?: string
    title?: string
  }>): Promise<RpcResponse<{ workspace: WorkspaceView; created: boolean }>>

  /**
   * Renames a workspace. `title` is trimmed and must be non-empty
   * (schema-enforced). An unknown id fails with `workspace-not-found`; a
   * title equal to another workspace's fails with `workspace-name-conflict`.
   * Renaming to the current title is a no-op success (no durable write).
   */
  rename(request: RpcRequest<{ workspaceId: WorkspaceId; title: string }>):
  Promise<RpcResponse<{ workspace: WorkspaceView }>>

  /**
   * Removes one Workspace registration. The directory, every user file, and
   * every session log remain untouched; those Sessions consequently become
   * ungrouped. An unknown id fails with `workspace-not-found`.
   */
  delete(request: RpcRequest<{ workspaceId: WorkspaceId }>):
  Promise<RpcResponse<{ deleted: true }>>

  /**
   * Moves one Workspace within the registry display order,
   * DOM-insertBefore-like. An omitted anchor appends to the end.
   */
  insertBefore(request: RpcRequest<{
    workspaceId: WorkspaceId
    beforeWorkspaceId?: WorkspaceId
  }>): Promise<RpcResponse<{ workspaceIds: WorkspaceId[] }>>

  /**
   * Moves an accounted session within its workspace's manual order,
   * DOM-insertBefore-like: with `beforeSessionId` the session is inserted
   * before that anchor; omitted appends to the end. An unknown workspace
   * fails with `workspace-not-found`; a session or anchor not accounted by
   * the workspace fails with `workspace-move-invalid`. A move to the current
   * position is a no-op success.
   */
  insertSessionBefore(request: RpcRequest<{
    workspaceId: WorkspaceId
    sessionId: SessionId
    beforeSessionId?: SessionId
  }>): Promise<RpcResponse<{ workspace: WorkspaceView }>>

  /**
   * Adds one session to the registry-global archive set: the session
   * disappears from every grouping surface but keeps its session log and its
   * workspace accounting slot (a future unarchive restores its position).
   * Idempotent for an already archived id. A session neither live nor in
   * session persistence fails with `session-not-found`. Returns the full
   * updated set (same snapshot the changed frame carries).
   */
  archiveSession(request: RpcRequest<{ sessionId: SessionId }>):
  Promise<RpcResponse<{ archivedSessionIds: SessionId[] }>>

  /**
   * Git working-copy status. A local workspace fails with `workspace-not-git`.
   * An unknown or non-visible id fails with `workspace-not-found`.
   */
  gitStatus(request: RpcRequest<{ workspaceId: WorkspaceId }>):
  Promise<RpcResponse<{ status: GitWorkspaceStatusView }>>

  /**
   * Stage every change and commit. `message` must be non-empty.
   */
  gitCommit(request: RpcRequest<{ workspaceId: WorkspaceId; message: string }>):
  Promise<RpcResponse<{ commit: string }>>

  /**
   * Push the current branch to `origin`.
   */
  gitPush(request: RpcRequest<{ workspaceId: WorkspaceId }>):
  Promise<RpcResponse<{ pushed: true }>>

  /**
   * Fast-forward pull. Conflicted paths are returned rather than throwing when
   * the working copy cannot fast-forward cleanly.
   */
  gitPull(request: RpcRequest<{ workspaceId: WorkspaceId }>):
  Promise<RpcResponse<{ conflicted: string[] }>>

  /**
   * Check out `branch`, creating it from `origin/branch` when needed.
   */
  gitCheckoutBranch(request: RpcRequest<{ workspaceId: WorkspaceId; branch: string }>):
  Promise<RpcResponse<{ branch: string }>>
}
