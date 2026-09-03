/**
 * Local-directory provider for `ctx.workspaceSource` (`kind: 'local'`).
 * Canonicalizes an existing directory through `fs.realpath`; prepare is that
 * same check plus a directory stat.
 * @module @deepseek-ai/dsh-workspace-source-local
 */

import { realpath, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import {
  WorkspaceSourceError,
  type WorkspaceCheckout,
  type WorkspaceSourceProvider,
  type WorkspaceSourceRequest,
  type WorkspaceSourceSpec,
} from '@deepseek-ai/dsh-workspace-source'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'workspace-source-local'

/** The workspace-source seam this provider registers into. */
export const inject = ['workspaceSource']

/**
 * Canonicalize `path` through `fs.realpath` and require an existing directory.
 * @param path - directory in any spelling.
 * @returns the canonical absolute path.
 */
export async function resolveLocalPath(path: string): Promise<string> {
  let canonical: string
  try {
    canonical = await realpath(path)
  } catch (error) {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_INVALID_REQUEST',
      `cannot resolve local workspace path '${path}'`,
      { cause: error },
    )
  }
  if (!(await stat(canonical)).isDirectory()) {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_INVALID_REQUEST',
      `cannot use '${canonical}' as a local workspace: path is not a directory`,
    )
  }
  return canonical
}

const localProvider: WorkspaceSourceProvider = {
  kind: 'local',
  async resolve(request: WorkspaceSourceRequest): Promise<WorkspaceSourceSpec> {
    if (request.kind !== 'local') {
      throw new WorkspaceSourceError(
        'WORKSPACE_SOURCE_INVALID_REQUEST',
        `local workspace-source provider received kind "${request.kind}"`,
      )
    }
    const path = await resolveLocalPath(request.path)
    return { kind: 'local', path }
  },
  async prepare(spec: WorkspaceSourceSpec): Promise<WorkspaceCheckout> {
    if (spec.kind !== 'local') {
      throw new WorkspaceSourceError(
        'WORKSPACE_SOURCE_INVALID_REQUEST',
        `local workspace-source provider received kind "${spec.kind}"`,
      )
    }
    const path = await resolveLocalPath(spec.path)
    return { cwd: path, spec: { kind: 'local', path } }
  },
}

/**
 * Register the local-directory provider with `ctx.workspaceSource`.
 * @param ctx - context that already provides `workspaceSource`.
 */
export function apply(ctx: Context): void {
  ctx.workspaceSource.register(localProvider)
}
