/**
 * Service Definition for the workspace-source capability (`ctx.workspaceSource`):
 * providers register by `kind` and implement resolve/prepare (and git
 * operations for `kind: 'git'`). Duplicate kinds are rejected. A missing
 * kind fails at the call, not at load.
 * @module @deepseek-ai/dsh-workspace-source
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { WorkspaceSourceError } from './error.ts'
import type {
  GitCommitResult,
  GitPullResult,
  GitWorkspaceSource,
  GitWorkspaceStatus,
  WorkspaceCheckout,
  WorkspaceSourceKind,
  WorkspaceSourceRequest,
  WorkspaceSourceSpec,
} from './types.ts'

export { WorkspaceSourceError } from './error.ts'
export type { WorkspaceSourceErrorCode } from './error.ts'
export type {
  GitCommitResult,
  GitPullResult,
  GitWorkspaceProvider,
  GitWorkspaceRequest,
  GitWorkspaceSource,
  GitWorkspaceStatus,
  LocalWorkspaceRequest,
  LocalWorkspaceSource,
  WorkspaceCheckout,
  WorkspaceSourceKind,
  WorkspaceSourceRecord,
  WorkspaceSourceRequest,
  WorkspaceSourceSpec,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceSource: WorkspaceSource
  }
}

/**
 * One registered origin implementation. The seam dispatches by
 * {@link WorkspaceSourceProvider.kind}; git operations live only on the git
 * provider and the seam rejects them for any other kind.
 */
export interface WorkspaceSourceProvider {
  readonly kind: WorkspaceSourceKind
  /**
   * Apply provider-owned defaults and canonicalize a request into a durable spec.
   * @param request - caller request of this provider's kind.
   * @returns the spec the registry may store; never a token.
   */
  resolve(request: WorkspaceSourceRequest): Promise<WorkspaceSourceSpec>
  /**
   * Materialize or refresh the local working copy named by `spec`.
   * @param spec - a spec previously returned by {@link resolve}, or the durable record copy.
   * @returns the canonical cwd the agent loop should use.
   */
  prepare(spec: WorkspaceSourceSpec): Promise<WorkspaceCheckout>
  /**
   * Report working-copy status. Required on the git provider; omitted elsewhere.
   * @param spec - git spec whose checkout to inspect.
   * @returns branch, dirty, ahead/behind, conflicts, and last-pushed time.
   */
  status?(spec: GitWorkspaceSource): Promise<GitWorkspaceStatus>
  /**
   * Stage every change and create a commit. Required on the git provider.
   * @param spec - git spec whose checkout to commit.
   * @param message - non-empty commit message.
   * @returns the new `HEAD` object name.
   */
  commit?(spec: GitWorkspaceSource, message: string): Promise<GitCommitResult>
  /**
   * Push the current branch to `origin`. Required on the git provider.
   * @param spec - git spec whose checkout to push.
   */
  push?(spec: GitWorkspaceSource): Promise<void>
  /**
   * Fast-forward pull the current branch. Required on the git provider.
   * @param spec - git spec whose checkout to pull.
   * @returns conflicted paths when the pull cannot fast-forward into a clean tree.
   */
  pull?(spec: GitWorkspaceSource): Promise<GitPullResult>
  /**
   * Check out `branch`, creating the local branch from `origin/branch` when needed.
   * @param spec - git spec whose checkout to switch.
   * @param branch - branch name.
   */
  checkoutBranch?(spec: GitWorkspaceSource, branch: string): Promise<void>
}

/**
 * Workspace origin registry. Load one instance per context as
 * `ctx.workspaceSource`; providers register into it.
 */
export class WorkspaceSource extends Service {
  private readonly providers = new Map<WorkspaceSourceKind, WorkspaceSourceProvider>()

  /**
   * @param ctx - Cordis context this service is installed on.
   */
  constructor(ctx: Context) {
    super(ctx, 'workspaceSource')
  }

  /**
   * Register a provider for one kind. Throws
   * {@link WorkspaceSourceError} `WORKSPACE_SOURCE_DUPLICATE_KIND` when that
   * kind is already registered. The disposer unregisters on fiber disposal.
   * @param provider - implementation whose `kind` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  register(provider: WorkspaceSourceProvider): () => void {
    if (this.providers.has(provider.kind)) {
      throw new WorkspaceSourceError(
        'WORKSPACE_SOURCE_DUPLICATE_KIND',
        `a workspace-source provider for kind "${provider.kind}" is already registered`,
      )
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.kind, provider)
      yield () => providers.delete(provider.kind)
    }, 'workspaceSource.register()')
    return () => void dispose()
  }

  /**
   * Canonicalize a request through the provider for `request.kind`.
   * @param request - local path or git remote request.
   * @returns the durable spec; never contains a token.
   */
  async resolve(request: WorkspaceSourceRequest): Promise<WorkspaceSourceSpec> {
    return await this.require(request.kind).resolve(request)
  }

  /**
   * Materialize or refresh the working copy, then return its canonical cwd.
   * @param spec - local or git spec (the durable workspace `source` field).
   * @returns the checkout the agent/session machinery uses as cwd.
   */
  async prepare(spec: WorkspaceSourceSpec): Promise<WorkspaceCheckout> {
    return await this.require(spec.kind).prepare(spec)
  }

  /**
   * Report git working-copy status.
   * @param spec - git spec whose checkout to inspect.
   * @returns branch, dirty, ahead/behind, conflicts, and last-pushed time.
   */
  async status(spec: GitWorkspaceSource): Promise<GitWorkspaceStatus> {
    return await this.gitOp(spec, 'status', op => op(spec))
  }

  /**
   * Stage every change and create a commit on the git checkout.
   * @param spec - git spec whose checkout to commit.
   * @param message - non-empty commit message.
   * @returns the new `HEAD` object name.
   */
  async commit(spec: GitWorkspaceSource, message: string): Promise<GitCommitResult> {
    return await this.gitOp(spec, 'commit', op => op(spec, message))
  }

  /**
   * Push the current branch to `origin`.
   * @param spec - git spec whose checkout to push.
   */
  async push(spec: GitWorkspaceSource): Promise<void> {
    await this.gitOp(spec, 'push', op => op(spec))
  }

  /**
   * Fast-forward pull the current branch.
   * @param spec - git spec whose checkout to pull.
   * @returns conflicted paths when the pull cannot complete cleanly.
   */
  async pull(spec: GitWorkspaceSource): Promise<GitPullResult> {
    return await this.gitOp(spec, 'pull', op => op(spec))
  }

  /**
   * Check out `branch` on the git working copy.
   * @param spec - git spec whose checkout to switch.
   * @param branch - branch name.
   */
  async checkoutBranch(spec: GitWorkspaceSource, branch: string): Promise<void> {
    await this.gitOp(spec, 'checkoutBranch', op => op(spec, branch))
  }

  private require(kind: WorkspaceSourceKind): WorkspaceSourceProvider {
    const provider = this.providers.get(kind)
    if (provider === undefined) {
      throw new WorkspaceSourceError(
        'WORKSPACE_SOURCE_UNKNOWN_KIND',
        `no workspace-source provider is registered for kind "${kind}"`,
      )
    }
    return provider
  }

  private async gitOp<K extends 'status' | 'commit' | 'push' | 'pull' | 'checkoutBranch', T>(
    spec: GitWorkspaceSource,
    method: K,
    run: (op: NonNullable<WorkspaceSourceProvider[K]>) => Promise<T>,
  ): Promise<T> {
    const provider = this.require(spec.kind)
    const op = provider[method]
    if (op === undefined) {
      throw new WorkspaceSourceError(
        'WORKSPACE_SOURCE_NOT_GIT',
        `workspace-source provider "git" does not implement ${method}`,
      )
    }
    return await run(op)
  }
}

export default WorkspaceSource
