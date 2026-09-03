/**
 * Git checkout provider for `ctx.workspaceSource` (`kind: 'git'`): clone,
 * fetch, branch checkout, status, commit, push, and fast-forward pull.
 * Durable specs never store tokens.
 * @module @deepseek-ai/dsh-workspace-source-git
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-workspace-source'
import { createGitProvider } from './provider.ts'

export { parseGitRemote, sameGitRemote } from './remote.ts'
export type { ParsedGitRemote } from './remote.ts'
export {
  createGitProvider,
  gitCheckoutBranch,
  gitCommit,
  gitPull,
  gitPush,
  gitStatus,
  prepareGit,
  resolveGit,
} from './provider.ts'
export type { GitProviderLimits } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'workspace-source-git'

/** The workspace-source seam this provider registers into. */
export const inject = ['workspaceSource']

/** Plugin config: git subprocess timeout. */
export interface Config {
  /** Maximum milliseconds for clone, fetch, push, and pull. */
  operationTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  operationTimeoutMs: z.number().default(120_000),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/**
 * Register the git checkout provider with `ctx.workspaceSource`.
 * @param ctx - context that already provides `workspaceSource`.
 * @param config - subprocess timeout; schemastery fills the default.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  if (!Number.isFinite(resolved.operationTimeoutMs) || resolved.operationTimeoutMs <= 0) {
    throw new Error('workspace-source-git: operationTimeoutMs must be a positive finite number')
  }
  ctx.workspaceSource.register(createGitProvider({
    operationTimeoutMs: resolved.operationTimeoutMs,
  }))
}
