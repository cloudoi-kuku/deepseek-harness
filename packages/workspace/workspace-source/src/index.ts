/**
 * Workspace source seam (`ctx.workspaceSource`): resolve a request to a spec,
 * then prepare a local cwd. Providers register by `kind`.
 * @module @deepseek-ai/dsh-workspace-source
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  GitWorkspaceStatus,
  WorkspaceCheckout,
  WorkspaceSourceRequest,
  WorkspaceSpec,
} from './types.ts'

export type {
  GitWorkspaceRequest,
  GitWorkspaceSpec,
  GitWorkspaceStatus,
  LocalWorkspaceRequest,
  LocalWorkspaceSpec,
  WorkspaceCheckout,
  WorkspaceSourceRequest,
  WorkspaceSpec,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceSource: WorkspaceSource
  }
}

/**
 * One implementation of a workspace kind. Registrations are effects.
 */
export interface WorkspaceSourceProvider {
  readonly kind: WorkspaceSpec['kind']
  /**
   * Fill every spec field from a request. Must not clone or touch the network.
   * @param request - caller request of this provider's kind.
   * @returns a durable spec.
   */
  resolve(request: WorkspaceSourceRequest): WorkspaceSpec
  /**
   * Materialize or refresh the checkout and return its canonical cwd.
   * @param spec - previously resolved spec.
   * @returns the directory sessions must use.
   */
  prepare(spec: WorkspaceSpec): Promise<WorkspaceCheckout>
}

/**
 * A Git provider additionally exposes status and sync. Local providers omit this.
 */
export interface GitWorkspaceSourceProvider extends WorkspaceSourceProvider {
  readonly kind: 'git'
  /**
   * @param cwd - prepared checkout.
   * @returns branch and dirty/ahead/behind counts.
   */
  status(cwd: string): Promise<GitWorkspaceStatus>
  /**
   * @param cwd - prepared checkout.
   * @param message - non-blank commit message.
   */
  commit(cwd: string, message: string): Promise<void>
  /**
   * @param cwd - prepared checkout.
   */
  push(cwd: string): Promise<void>
  /**
   * @param cwd - prepared checkout.
   */
  pull(cwd: string): Promise<void>
  /**
   * @param cwd - prepared checkout.
   * @param branch - existing or new local branch name.
   */
  checkoutBranch(cwd: string, branch: string): Promise<void>
}

/**
 * Dispatcher over registered workspace-source providers.
 */
export class WorkspaceSource extends Service {
  private readonly providers = new Map<string, WorkspaceSourceProvider>()

  /**
   * @param ctx - host context.
   */
  constructor(ctx: Context) {
    super(ctx, 'workspaceSource')
  }

  /**
   * Register one kind. Duplicate kinds throw. Returns the disposer.
   * @param provider - local or git implementation.
   * @returns unregistration.
   */
  register(provider: WorkspaceSourceProvider): () => void {
    if (this.providers.has(provider.kind)) {
      throw new Error(`workspace source kind '${provider.kind}' is already registered`)
    }
    const dispose = this.ctx.effect(() => {
      this.providers.set(provider.kind, provider)
      return () => { this.providers.delete(provider.kind) }
    }, `workspaceSource.register.${provider.kind}`)
    return () => { void dispose() }
  }

  /**
   * Canonicalize a request through the provider for `request.kind`.
   * @param request - local path or git remote.
   * @returns the spec to store on the workspace record.
   */
  resolve(request: WorkspaceSourceRequest): WorkspaceSpec {
    return this.provider(request.kind).resolve(request)
  }

  /**
   * Materialize or refresh the working copy and return its canonical cwd.
   * @param spec - stored source.
   * @returns canonical cwd for session.create.
   */
  prepare(spec: WorkspaceSpec): Promise<WorkspaceCheckout> {
    return this.provider(spec.kind).prepare(spec)
  }

  /**
   * Return the mounted git provider. Throws when no git provider is registered.
   * @returns the git provider.
   */
  git(): GitWorkspaceSourceProvider {
    const provider = this.providers.get('git')
    if (provider === undefined || provider.kind !== 'git') {
      throw new Error("workspace source kind 'git' is not registered")
    }
    return provider as GitWorkspaceSourceProvider
  }

  private provider(kind: string): WorkspaceSourceProvider {
    const provider = this.providers.get(kind)
    if (provider === undefined) {
      throw new Error(`workspace source kind '${kind}' is not registered`)
    }
    return provider
  }
}

export default WorkspaceSource
