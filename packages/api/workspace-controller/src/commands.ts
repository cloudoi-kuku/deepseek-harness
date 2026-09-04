/** Workspace command implementation and stable Remote failure mapping. */

import type { Context } from '@deepseek-ai/cordis'
import type { GitWorkspaceSourceProvider } from '@deepseek-ai/dsh-workspace-source'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  WorkspaceCheckoutParentRequiredError,
  WorkspaceForbiddenError,
  WorkspaceId,
  WorkspaceMoveInvalidError,
  WorkspaceOrderInvalidError,
  WorkspaceSourceUnavailableError,
  WorkspaceUnknownSessionError,
} from '@deepseek-ai/dsh-workspace'
import { HostedLimitsError } from '@deepseek-ai/dsh-hosted-limits'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { workspaceView } from './feed.ts'
import type {
  GitWorkspaceStatusValue,
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateGitRequest,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceGitCheckoutBranchRequest,
  WorkspaceGitCommitRequest,
  WorkspaceGitStatusRequest,
  WorkspaceGitSyncRequest,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceValue,
} from './types.ts'

/** Implements Workspace mutations against the authoritative registry. */
export class WorkspaceCommands {
  private operationTail = Promise.resolve()

  /** @param ctx - Host context containing the Workspace registry. */
  constructor(private readonly ctx: Context) {}

  /**
   * Create or resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.enqueue(async () => {
      try {
        const existing = await this.ctx.workspaceRegistry.resolveByPath(request.path)
        if (existing !== undefined) {
          return { workspace: workspaceView(existing), created: false }
        }
        const workspace = await this.ctx.workspaceRegistry.create(request.path)
        return { workspace: workspaceView(workspace), created: true }
      } catch (error) {
        if (error instanceof TypertRemoteFailure) throw error
        throw failure(
          'workspace-invalid-path',
          `cannot create a Workspace at "${request.path}": ${errorMessage(error)}`,
          { path: request.path },
        )
      }
    })
  }

  /**
   * Create or resolve one Git Workspace.
   * @param request - remote URL and checkout parent.
   * @returns the Workspace and whether this call created it.
   */
  createGit(request: WorkspaceCreateGitRequest): Promise<WorkspaceCreateValue> {
    return this.enqueue(async () => {
      try {
        const known = new Set(this.ctx.workspaceRegistry.list().map(workspace => workspace.id))
        const workspace = await this.ctx.workspaceRegistry.createGit(request)
        return { workspace: workspaceView(workspace), created: !known.has(workspace.id) }
      } catch (error) {
        if (error instanceof TypertRemoteFailure) throw error
        const policy = policyFailure(error)
        if (policy !== undefined) throw policy
        if (error instanceof WorkspaceSourceUnavailableError) {
          throw failure('workspace-source-unavailable', error.message, { kind: 'git' })
        }
        if (error instanceof WorkspaceCheckoutParentRequiredError) {
          throw failure('workspace-invalid-path', error.message, { path: request.remoteUrl })
        }
        if (error instanceof WorkspaceForbiddenError) {
          throw workspaceNotFound(error.workspaceId)
        }
        throw failure(
          'workspace-invalid-path',
          `cannot create a Git Workspace from "${request.remoteUrl}": ${errorMessage(error)}`,
          { path: request.remoteUrl },
        )
      }
    })
  }

  /**
   * Rename one Workspace after serializing title ownership checks.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    const title = request.title.trim()
    if (title === '') {
      return Promise.reject(failure(
        'bad-request',
        'Workspace rename requires a non-blank title',
        {},
      ))
    }
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      if (title !== workspace.title) {
        if (this.ctx.workspaceRegistry.list().some(candidate =>
          candidate.id !== workspace.id && candidate.title === title)) {
          throw failure(
            'workspace-name-conflict',
            `Workspace name '${title}' is already in use`,
            { name: title },
          )
        }
        await workspace.setTitle(title)
      }
      return { workspace: workspaceView(workspace) }
    })
  }

  /**
   * Delete one Workspace registration without deleting its directory or Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.enqueue(async () => {
      if (!await this.ctx.workspaceRegistry.delete(WorkspaceId(request.workspaceId))) {
        throw workspaceNotFound(request.workspaceId)
      }
      return { deleted: true }
    })
  }

  /**
   * Move one Workspace within the durable registry order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  async insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    try {
      const workspaceIds = await this.ctx.workspaceRegistry.insertBefore(
        WorkspaceId(request.workspaceId),
        request.beforeWorkspaceId === undefined
          ? undefined
          : WorkspaceId(request.beforeWorkspaceId),
      )
      return { workspaceIds: [...workspaceIds] }
    } catch (error) {
      if (!(error instanceof WorkspaceOrderInvalidError)) throw error
      throw workspaceNotFound(error.workspaceId)
    }
  }

  /**
   * Move one accounted Session within a Workspace's manual order.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  async insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    const workspace = this.requireWorkspace(request.workspaceId)
    try {
      await workspace.insertSessionBefore(request.sessionId, request.beforeSessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceMoveInvalidError)) throw error
      throw failure(
        'workspace-move-invalid',
        error.message,
        {
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...request.beforeSessionId === undefined
            ? {}
            : { beforeSessionId: request.beforeSessionId },
        },
      )
    }
    return { workspace: workspaceView(workspace) }
  }

  /**
   * Add one known Session to the registry-global archive set.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  async archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    try {
      await this.ctx.workspaceRegistry.archiveSession(request.sessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceUnknownSessionError)) throw error
      throw failure('session-not-found', error.message, { sessionId: request.sessionId })
    }
    return { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] }
  }

  /**
   * Git working-copy status for a git workspace.
   * @param request - workspace identity.
   * @returns branch and dirty/ahead/behind counts.
   */
  gitStatus(request: WorkspaceGitStatusRequest): Promise<{ status: GitWorkspaceStatusValue }> {
    return this.gitOp(request.workspaceId, async (cwd, git) => ({
      status: await git.status(cwd),
    }))
  }

  /**
   * Stage all changes and commit.
   * @param request - workspace identity and commit message.
   * @returns confirmation.
   */
  gitCommit(request: WorkspaceGitCommitRequest): Promise<{ committed: true }> {
    const message = request.message.trim()
    if (message === '') {
      return Promise.reject(failure('bad-request', 'git commit requires a non-blank message', {}))
    }
    return this.gitOp(request.workspaceId, async (cwd, git) => {
      await git.commit(cwd, message)
      return { committed: true as const }
    })
  }

  /**
   * Push HEAD to origin.
   * @param request - workspace identity.
   * @returns confirmation.
   */
  gitPush(request: WorkspaceGitSyncRequest): Promise<{ pushed: true }> {
    return this.gitOp(request.workspaceId, async (cwd, git) => {
      await git.push(cwd)
      return { pushed: true as const }
    })
  }

  /**
   * Fast-forward from origin.
   * @param request - workspace identity.
   * @returns confirmation.
   */
  gitPull(request: WorkspaceGitSyncRequest): Promise<{ pulled: true }> {
    return this.gitOp(request.workspaceId, async (cwd, git) => {
      await git.pull(cwd)
      return { pulled: true as const }
    })
  }

  /**
   * Check out or create a branch.
   * @param request - workspace identity and branch name.
   * @returns the requested branch.
   */
  gitCheckoutBranch(request: WorkspaceGitCheckoutBranchRequest): Promise<{ branch: string }> {
    const branch = request.branch.trim()
    if (branch === '') {
      return Promise.reject(failure('bad-request', 'git checkout requires a non-blank branch', {}))
    }
    return this.gitOp(request.workspaceId, async (cwd, git) => {
      await git.checkoutBranch(cwd, branch)
      return { branch }
    })
  }

  private gitOp<T>(
    workspaceId: WorkspaceId,
    fn: (cwd: string, git: GitWorkspaceSourceProvider) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(workspaceId)
      if (workspace.source.kind !== 'git') {
        throw failure(
          'workspace-not-git',
          `workspace "${workspaceId}" is not a git checkout`,
          { workspaceId },
        )
      }
      const source = this.ctx.get('workspaceSource')
      if (source === undefined) {
        throw failure(
          'workspace-source-unavailable',
          'cannot run a git workspace operation: ctx.workspaceSource is not mounted',
          { kind: 'git' },
        )
      }
      try {
        const owner = workspace.owner
        if (owner !== undefined) this.ctx.get('hostedLimits')?.assertGitOp(owner)
        else this.ctx.get('hostedLimits')?.assertNotKilled()
        return await fn(workspace.path, source.git())
      } catch (error) {
        const policy = policyFailure(error)
        if (policy !== undefined) throw policy
        throw error
      }
    })
  }

  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.getVisible(WorkspaceId(workspaceId))
    if (workspace === undefined) throw workspaceNotFound(workspaceId)
    return workspace
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function workspaceNotFound(workspaceId: WorkspaceId): TypertRemoteFailure {
  return failure(
    'workspace-not-found',
    `Workspace "${workspaceId}" not found`,
    { workspaceId },
  )
}

function failure(
  code: string,
  message: string,
  details: object,
): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}

function policyFailure(error: unknown): TypertRemoteFailure | undefined {
  if (!(error instanceof HostedLimitsError)) return undefined
  return failure(error.code, error.message, error.details)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
