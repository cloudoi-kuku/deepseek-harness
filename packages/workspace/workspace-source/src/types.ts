/**
 * Request/spec vocabulary for {@link WorkspaceSource}: a workspace is either
 * an existing local directory or a Git checkout. Tokens never appear here.
 * @module @deepseek-ai/dsh-workspace-source/src/types
 */

/** Local directory the host already has. */
export interface LocalWorkspaceRequest {
  readonly kind: 'local'
  /** Existing directory, any spelling; prepare canonicalizes it. */
  readonly path: string
}

/** Git remote to materialize as a local checkout. */
export interface GitWorkspaceRequest {
  readonly kind: 'git'
  /** Hosting vendor; GitHub is the first provider. */
  readonly provider: 'github'
  /** Clone URL without embedded credentials. */
  readonly remoteUrl: string
  /** GitHub owner; resolved from `remoteUrl` when omitted. */
  readonly owner?: string
  /** Repository name; resolved from `remoteUrl` when omitted. */
  readonly repo?: string
  /** Branch to check out; resolved to `main` when omitted. */
  readonly branch?: string
  /** Parent directory under which prepare creates the checkout. */
  readonly checkoutParent: string
  /** Credentials-store id; never a token. Absent for unauthenticated remotes. */
  readonly credentialId?: string | undefined
}

/** Caller request before {@link WorkspaceSource.resolve}. */
export type WorkspaceSourceRequest = LocalWorkspaceRequest | GitWorkspaceRequest

/** Fully filled local spec. */
export interface LocalWorkspaceSpec {
  readonly kind: 'local'
  readonly path: string
}

/** Fully filled Git spec stored on the workspace record. */
export interface GitWorkspaceSpec {
  readonly kind: 'git'
  readonly provider: 'github'
  readonly owner: string
  readonly repo: string
  readonly branch: string
  readonly remoteUrl: string
  readonly checkoutPath: string
  readonly credentialId?: string | undefined
}

/** Output of {@link WorkspaceSource.resolve}; stored as `WorkspaceRecord.source`. */
export type WorkspaceSpec = LocalWorkspaceSpec | GitWorkspaceSpec

/** Result of {@link WorkspaceSource.prepare}: the session cwd. */
export interface WorkspaceCheckout {
  /** Canonical existing directory. */
  readonly cwd: string
}

/** Dirty/branch projection for Git checkouts. */
export interface GitWorkspaceStatus {
  readonly branch: string
  readonly dirty: boolean
  readonly ahead: number
  readonly behind: number
}
