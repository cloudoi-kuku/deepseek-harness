/**
 * Vocabulary of the workspace-source capability: discriminated checkout
 * requests/specs, the resolved local cwd, and Git status. Types only.
 * @module @deepseek-ai/dsh-workspace-source/src/types
 */

/** Discriminator for a workspace checkout origin. */
export type WorkspaceSourceKind = 'local' | 'git'

/** Git host family recorded on a git workspace. Tokens are never stored. */
export type GitWorkspaceProvider = 'github' | 'generic'

/**
 * Open an existing local directory. The path is canonicalized at resolve
 * time; a missing or non-directory path rejects.
 */
export interface LocalWorkspaceRequest {
  readonly kind: 'local'
  /** Directory to own, in any path spelling. */
  readonly path: string
}

/**
 * Clone or reuse a Git remote. `credentialId` names a credentials-seam
 * record when one exists; the request never carries a token.
 */
export interface GitWorkspaceRequest {
  readonly kind: 'git'
  /** Clone URL (HTTPS, SSH, or `file:`). */
  readonly remoteUrl: string
  /** Absolute directory under which `${owner}-${repo}` is checked out. */
  readonly checkoutParent: string
  /** Branch to check out; omitted uses `main`. */
  readonly branch?: string
  /** Override owner parsed from {@link remoteUrl}. */
  readonly owner?: string
  /** Override repository name parsed from {@link remoteUrl}. */
  readonly repo?: string
  /** Optional credentials-seam record id; never a secret. */
  readonly credentialId?: string | undefined
}

/** Input to {@link import('./index.ts').WorkspaceSource.resolve}. */
export type WorkspaceSourceRequest = LocalWorkspaceRequest | GitWorkspaceRequest

/**
 * Durable local origin: the canonical directory is both identity and cwd.
 * Tokens are never stored.
 */
export interface LocalWorkspaceSource {
  readonly kind: 'local'
  /** Canonical directory path (`fs.realpath` at resolve/prepare). */
  readonly path: string
}

/**
 * Durable Git origin. `checkoutPath` is the local working copy; credentials
 * stay in the credentials seam, referenced only by {@link credentialId}.
 */
export interface GitWorkspaceSource {
  readonly kind: 'git'
  readonly provider: GitWorkspaceProvider
  readonly owner: string
  readonly repo: string
  readonly branch: string
  readonly remoteUrl: string
  /** Absolute working-copy path (realpath after a successful prepare). */
  readonly checkoutPath: string
  /** Optional credentials-seam record id; omitted means the public/default Git environment. */
  readonly credentialId?: string | undefined
}

/**
 * Durable workspace `source` field and the spec {@link import('./index.ts').WorkspaceSource.prepare}
 * accepts. Identical on purpose: the registry stores the resolved spec.
 */
export type WorkspaceSourceRecord = LocalWorkspaceSource | GitWorkspaceSource

/** Alias of {@link WorkspaceSourceRecord} used at the resolve/prepare seam. */
export type WorkspaceSourceSpec = WorkspaceSourceRecord

/** Result of preparing a spec: the local directory the agent loop uses as cwd. */
export interface WorkspaceCheckout {
  /** Canonical existing directory. */
  readonly cwd: string
  readonly spec: WorkspaceSourceSpec
}

/** Working-copy status reported by the git provider. */
export interface GitWorkspaceStatus {
  /** Current branch, or `HEAD` when detached. */
  readonly branch: string
  /** True when the worktree or index differs from `HEAD`. */
  readonly dirty: boolean
  /** Commits ahead of the upstream; `0` when no upstream is configured. */
  readonly ahead: number
  /** Commits behind the upstream; `0` when no upstream is configured. */
  readonly behind: number
  /** Paths with unresolved merge conflicts. */
  readonly conflicted: readonly string[]
  /** Author timestamp of the upstream tip, when an upstream exists. */
  readonly lastPushedAt?: string
}

/** Outcome of `git pull --ff-only`. */
export interface GitPullResult {
  /** Paths with unresolved merge conflicts after the pull attempt. */
  readonly conflicted: readonly string[]
}

/** Outcome of `git commit`. */
export interface GitCommitResult {
  /** Object name of the new `HEAD`. */
  readonly commit: string
}
