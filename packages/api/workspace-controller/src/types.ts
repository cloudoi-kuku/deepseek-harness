/**
 * Browser-safe request, result, and state-stream vocabulary for the Workspace
 * and directory-picking Remote namespaces this package owns. The picking seam
 * declares its own listing types, so they are re-exported here rather than
 * restated: a browser consumer reads the very declaration the backend answers.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { z as zCore } from 'zod'

type ZodIssue = zCore.core.$ZodIssue

export type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
export type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'

/** One durable Workspace projected for browser consumers. */
export interface WorkspaceView {
  readonly workspaceId: WorkspaceId
  /** Canonical host directory path. */
  readonly path: string
  /** Local directory or Git checkout origin. Absent only on fixtures that predate source. */
  readonly source?: {
    readonly kind: 'local' | 'git'
    readonly path?: string
    readonly provider?: 'github'
    readonly owner?: string
    readonly repo?: string
    readonly branch?: string
    readonly remoteUrl?: string
    readonly checkoutPath?: string
  }
  /** Tenant+user owner when created under an authenticated principal. */
  readonly owner?: { readonly tenantId: string; readonly userId: string }
  /** User-visible title. */
  readonly title: string
  /** Sessions accounted to this Workspace in manual order. */
  readonly sessionIds: readonly SessionId[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

/** Stable Workspace failure details returned by unary methods. */
export interface WorkspaceErrorDetailsMap {
  'bad-request': Record<never, never>
  'workspace-invalid-path': { readonly path: string }
  'workspace-not-found': { readonly workspaceId: WorkspaceId }
  'workspace-name-conflict': { readonly name: string }
  'workspace-not-git': { readonly workspaceId: WorkspaceId }
  'workspace-source-unavailable': { readonly kind: string }
  'kill-switch': Record<never, never>
  'quota-exceeded': { readonly kind?: string; readonly limit?: number }
  'rate-limited': { readonly kind?: string; readonly limit?: number }
  'workspace-move-invalid': {
    readonly workspaceId: WorkspaceId
    readonly sessionId: SessionId
    readonly beforeSessionId?: SessionId
  }
  'session-not-found': { readonly sessionId: SessionId }
}

/** Workspace business failure returned without throwing a carrier error. */
export type WorkspaceError = {
  [Code in keyof WorkspaceErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: WorkspaceErrorDetailsMap[Code]
  }
}[keyof WorkspaceErrorDetailsMap]

/** Stable directory-picking failure details returned by the picking wire verbs. */
export interface DirectoryPickerErrorDetailsMap {
  /** The directory creation request violates its semantic input constraints. */
  'bad-request': { readonly issues: ZodIssue[] }
  /** The verb needs an interaction the composed backend does not serve. */
  'directory-picker-unavailable': { readonly capability: string }
  /** The target is not fully qualified, or the backend cannot list it. */
  'directory-unreadable': { readonly path: string }
  /** A child of that name is already there. */
  'directory-exists': { readonly path: string }
  /** The parent is not fully qualified, the name is not one segment, or creation failed. */
  'directory-create-failed': { readonly path: string }
  /** The caller's own timeout or disconnect ended the chooser or the scan. */
  cancelled: Record<never, never>
  /** A backend failure with no seam code of its own. */
  internal: Record<never, never>
}

/** `auth.me` value. Never includes a token. */
export type AuthMeValue =
  | { readonly authenticated: false }
  | {
    readonly authenticated: true
    readonly tenantId: string
    readonly userId: string
    readonly product?: string | undefined
  }

/** Existing directory requested for Workspace adoption. */
export interface WorkspaceCreateRequest {
  readonly path: string
}

/** Git remote requested for Workspace adoption. Tokens are never in this payload. */
export interface WorkspaceCreateGitRequest {
  readonly remoteUrl: string
  readonly checkoutParent?: string | undefined
  readonly owner?: string | undefined
  readonly repo?: string | undefined
  readonly branch?: string | undefined
  readonly credentialId?: string | undefined
  readonly title?: string | undefined
}

/** Git working-copy status. Tokens are never included. */
export interface GitWorkspaceStatusValue {
  readonly branch: string
  readonly dirty: boolean
  readonly ahead: number
  readonly behind: number
}

/** Git status request. */
export interface WorkspaceGitStatusRequest {
  readonly workspaceId: WorkspaceId
}

/** Git commit request. */
export interface WorkspaceGitCommitRequest {
  readonly workspaceId: WorkspaceId
  readonly message: string
}

/** Git push/pull request. */
export interface WorkspaceGitSyncRequest {
  readonly workspaceId: WorkspaceId
}

/** Git branch checkout request. */
export interface WorkspaceGitCheckoutBranchRequest {
  readonly workspaceId: WorkspaceId
  readonly branch: string
}

/** Created or previously registered Workspace. */
export interface WorkspaceCreateValue {
  readonly workspace: WorkspaceView
  readonly created: boolean
}

/** Workspace title mutation. */
export interface WorkspaceRenameRequest {
  readonly workspaceId: WorkspaceId
  readonly title: string
}

/** Workspace mutation returning the complete changed row. */
export interface WorkspaceValue {
  readonly workspace: WorkspaceView
}

/** Workspace registration deletion. */
export interface WorkspaceDeleteRequest {
  readonly workspaceId: WorkspaceId
}

/** Receipt after one Workspace registration is deleted. */
export interface WorkspaceDeleteValue {
  readonly deleted: true
}

/** DOM-insertBefore-like Workspace order mutation. */
export interface WorkspaceInsertBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly beforeWorkspaceId?: WorkspaceId
}

/** Complete Workspace registry order after a mutation. */
export interface WorkspaceOrderValue {
  readonly workspaceIds: readonly WorkspaceId[]
}

/** DOM-insertBefore-like Session membership order mutation. */
export interface WorkspaceInsertSessionBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
  readonly beforeSessionId?: SessionId
}

/** Session requested for archival from Workspace grouping surfaces. */
export interface WorkspaceArchiveSessionRequest {
  readonly sessionId: SessionId
}

/** Complete archived Session set after a mutation. */
export interface WorkspaceArchiveValue {
  readonly archivedSessionIds: readonly SessionId[]
}

/** Complete reconnect baseline for Workspace browser state. */
export interface WorkspaceBaseline {
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly SessionId[]
}

/** One ordered Workspace change after a generation's baseline. */
export type WorkspaceFollowIncrement =
  | { readonly type: 'upsert'; readonly workspace: WorkspaceView }
  | { readonly type: 'remove'; readonly workspaceId: WorkspaceId }
  | { readonly type: 'order'; readonly workspaceIds: readonly WorkspaceId[] }
  | { readonly type: 'archived'; readonly archivedSessionIds: readonly SessionId[] }

/** Workspace state stream; every generation starts with exactly one baseline. */
export type WorkspaceFollowFrame =
  | { readonly type: 'baseline'; readonly value: WorkspaceBaseline }
  | WorkspaceFollowIncrement
