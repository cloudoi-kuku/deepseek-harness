/**
 * Local workspace-source provider: an existing host directory is the cwd.
 * @module @deepseek-ai/dsh-workspace-source-local
 */

import { stat } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import type { WorkspaceSourceProvider } from '@deepseek-ai/dsh-workspace-source'
import type {
  WorkspaceCheckout,
  WorkspaceSourceRequest,
  WorkspaceSpec,
} from '@deepseek-ai/dsh-workspace-source'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'

/**
 * Return the durable local source spec for an existing path request.
 * @param request - must be kind local.
 * @returns spec with a canonical path.
 */
export function resolveLocal(request: WorkspaceSourceRequest): WorkspaceSpec {
  if (request.kind !== 'local') {
    throw new Error(`local workspace source cannot resolve kind '${request.kind}'`)
  }
  return { kind: 'local', path: request.path }
}

/**
 * Validate and canonicalize the local directory for use as a session cwd.
 * @param spec - must be kind local.
 * @returns canonical existing directory.
 */
export async function prepareLocal(spec: WorkspaceSpec): Promise<WorkspaceCheckout> {
  if (spec.kind !== 'local') {
    throw new Error(`local workspace source cannot prepare kind '${spec.kind}'`)
  }
  const cwd = await realpathNormalize(spec.path)
  if (!(await stat(cwd)).isDirectory()) {
    throw new Error(`cannot prepare a local workspace at '${cwd}': path is not a directory`)
  }
  return { cwd }
}

const localProvider: WorkspaceSourceProvider = {
  kind: 'local',
  resolve: resolveLocal,
  prepare: prepareLocal,
}

/**
 * Registers the local provider on `ctx.workspaceSource`.
 */
export default class LocalWorkspaceSource extends Service {
  static inject = ['workspaceSource']

  /**
   * @param ctx - host context with workspaceSource.
   */
  constructor(ctx: Context) {
    super(ctx, 'workspaceSourceLocal')
    ctx.workspaceSource.register(localProvider)
  }
}
