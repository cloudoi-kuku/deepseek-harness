/** Disposable per-session workspace create and wipe. */

import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Create one exclusive temp directory under `parent`.
 * @param parent - absolute or cwd-relative parent directory.
 * @returns the created absolute workspace path.
 */
export async function createWorkspace(parent: string): Promise<string> {
  return mkdtemp(join(resolve(parent), 'dsh-generate-'))
}

/**
 * Recursively delete a workspace. Missing paths are ignored.
 * @param workspaceRoot - absolute directory created by {@link createWorkspace}.
 */
export async function wipeWorkspace(workspaceRoot: string): Promise<void> {
  await rm(workspaceRoot, { recursive: true, force: true })
}
