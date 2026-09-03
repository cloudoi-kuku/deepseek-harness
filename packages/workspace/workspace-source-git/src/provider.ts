/**
 * Git checkout provider implementation (`kind: 'git'`).
 * @module @deepseek-ai/dsh-workspace-source-git/src/provider
 */

import { mkdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { WorkspaceSourceError } from '@deepseek-ai/dsh-workspace-source'
import type {
  GitCommitResult,
  GitPullResult,
  GitWorkspaceSource,
  GitWorkspaceStatus,
  WorkspaceCheckout,
  WorkspaceSourceProvider,
  WorkspaceSourceRequest,
  WorkspaceSourceSpec,
} from '@deepseek-ai/dsh-workspace-source'
import { runGit, runGitAllowFail } from './git.ts'
import { parseGitRemote, sameGitRemote } from './remote.ts'

const DEFAULT_BRANCH = 'main'

/** Limits applied to every git subprocess. */
export interface GitProviderLimits {
  /** Maximum milliseconds for clone, fetch, push, and pull. */
  readonly operationTimeoutMs: number
}

/**
 * Build the git workspace-source provider.
 * @param limits - subprocess timeout.
 * @returns the provider registered as `kind: 'git'`.
 */
export function createGitProvider(limits: GitProviderLimits): WorkspaceSourceProvider {
  const timeoutMs = limits.operationTimeoutMs
  return {
    kind: 'git',
    resolve: request => resolveGit(request),
    prepare: spec => prepareGit(spec, timeoutMs),
    status: spec => gitStatus(spec, timeoutMs),
    commit: (spec, message) => gitCommit(spec, message, timeoutMs),
    push: spec => gitPush(spec, timeoutMs),
    pull: spec => gitPull(spec, timeoutMs),
    checkoutBranch: (spec, branch) => gitCheckoutBranch(spec, branch, timeoutMs),
  }
}

/**
 * Resolve a git request into a durable spec. Does not clone; {@link prepareGit} does.
 * @param request - git workspace request.
 * @returns spec with checkoutPath `join(checkoutParent, owner-repo)`.
 */
export async function resolveGit(request: WorkspaceSourceRequest): Promise<GitWorkspaceSource> {
  if (request.kind !== 'git') {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_INVALID_REQUEST',
      `git workspace-source provider received kind "${request.kind}"`,
    )
  }
  if (!isAbsolute(request.checkoutParent)) {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_INVALID_REQUEST',
      `git checkoutParent must be an absolute directory, got '${request.checkoutParent}'`,
    )
  }
  const parsed = parseGitRemote(request.remoteUrl)
  const owner = request.owner ?? parsed.owner
  const repo = request.repo ?? parsed.repo
  parseGitRemote(`https://example.invalid/${owner}/${repo}`)
  const branch = request.branch?.trim() || DEFAULT_BRANCH
  if (branch === '' || branch.includes('..') || /[\\/]/.test(branch)) {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_INVALID_REQUEST',
      `git branch '${branch}' is not a valid branch name`,
    )
  }
  const checkoutParent = resolve(request.checkoutParent)
  const checkoutPath = join(checkoutParent, `${owner}-${repo}`)
  return {
    kind: 'git',
    provider: parsed.provider,
    owner,
    repo,
    branch,
    remoteUrl: request.remoteUrl.trim(),
    checkoutPath,
    ...request.credentialId === undefined ? {} : { credentialId: request.credentialId },
  }
}

/**
 * Clone the remote when the checkout is missing; otherwise fetch, check out
 * the recorded branch, and fast-forward pull.
 * @param spec - git spec.
 * @param timeoutMs - subprocess timeout.
 * @returns canonical cwd and the spec with checkoutPath rewritten to that realpath.
 */
export async function prepareGit(spec: WorkspaceSourceSpec, timeoutMs: number): Promise<WorkspaceCheckout> {
  if (spec.kind !== 'git') {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_INVALID_REQUEST',
      `git workspace-source provider received kind "${spec.kind}"`,
    )
  }
  try {
    const existing = await existingCheckout(spec.checkoutPath)
    if (existing === undefined) {
      await mkdir(dirname(spec.checkoutPath), { recursive: true })
      await runGit(
        ['clone', '--branch', spec.branch, '--', spec.remoteUrl, spec.checkoutPath],
        { timeoutMs },
      )
    } else {
      await assertMatchingRemote(existing, spec, timeoutMs)
      await runGit(['fetch', '--', 'origin'], { cwd: existing, timeoutMs })
      await runGit(['checkout', spec.branch], { cwd: existing, timeoutMs }).catch(async () => {
        await runGit(['checkout', '-B', spec.branch, '--track', `origin/${spec.branch}`], {
          cwd: existing,
          timeoutMs,
        })
      })
      const pull = await runGitAllowFail(['pull', '--ff-only', '--', 'origin', spec.branch], {
        cwd: existing,
        timeoutMs,
      })
      if (pull.code !== 0 && !isAlreadyUpToDate(pull.stdout, pull.stderr)) {
        throw new WorkspaceSourceError(
          'WORKSPACE_SOURCE_PREPARE_FAILED',
          `cannot fast-forward '${existing}' from origin/${spec.branch}: ${pull.stderr || pull.stdout}`,
        )
      }
    }
    const cwd = await realpath(spec.checkoutPath)
    return { cwd, spec: { ...spec, checkoutPath: cwd } }
  } catch (error) {
    if (error instanceof WorkspaceSourceError) throw error
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_PREPARE_FAILED',
      `cannot prepare git checkout '${spec.checkoutPath}' from '${spec.remoteUrl}'`,
      { cause: error },
    )
  }
}

/**
 * Report branch, dirty, ahead/behind, conflicts, and last-pushed time.
 * @param spec - git spec.
 * @param timeoutMs - subprocess timeout.
 * @returns working-copy status.
 */
export async function gitStatus(spec: GitWorkspaceSource, timeoutMs: number): Promise<GitWorkspaceStatus> {
  const cwd = spec.checkoutPath
  const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs })
  const porcelain = await runGit(['status', '--porcelain'], { cwd, timeoutMs })
  const conflictedRaw = await runGitAllowFail(['diff', '--name-only', '--diff-filter=U'], { cwd, timeoutMs })
  const conflicted = conflictedRaw.stdout === '' ? [] : conflictedRaw.stdout.split('\n')
  const counts = await runGitAllowFail(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], {
    cwd,
    timeoutMs,
  })
  let ahead = 0
  let behind = 0
  if (counts.code === 0) {
    const [left, right] = counts.stdout.split(/\s+/)
    ahead = Number(left)
    behind = Number(right)
  }
  const lastPushed = await runGitAllowFail(['log', '-1', '--format=%cI', `origin/${branch}`], {
    cwd,
    timeoutMs,
  })
  return {
    branch,
    dirty: porcelain !== '',
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
    conflicted,
    ...lastPushed.code === 0 && lastPushed.stdout !== '' ? { lastPushedAt: lastPushed.stdout } : {},
  }
}

/**
 * Stage every change and create a commit with `message`.
 * @param spec - git spec.
 * @param message - commit message; blank rejects.
 * @param timeoutMs - subprocess timeout.
 * @returns new HEAD object name.
 */
export async function gitCommit(
  spec: GitWorkspaceSource,
  message: string,
  timeoutMs: number,
): Promise<GitCommitResult> {
  if (message.trim() === '') {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_INVALID_REQUEST',
      'git commit requires a non-empty message',
    )
  }
  const cwd = spec.checkoutPath
  await runGit(['add', '-A'], { cwd, timeoutMs })
  await runGit(['commit', '-m', message], { cwd, timeoutMs })
  const commit = await runGit(['rev-parse', 'HEAD'], { cwd, timeoutMs })
  return { commit }
}

/**
 * Push the current branch to `origin`.
 * @param spec - git spec.
 * @param timeoutMs - subprocess timeout.
 */
export async function gitPush(spec: GitWorkspaceSource, timeoutMs: number): Promise<void> {
  await runGit(['push', '--', 'origin', spec.branch], { cwd: spec.checkoutPath, timeoutMs })
}

/**
 * Fast-forward pull the recorded branch from `origin`.
 * @param spec - git spec.
 * @param timeoutMs - subprocess timeout.
 * @returns conflicted paths (empty when the fast-forward succeeded).
 */
export async function gitPull(spec: GitWorkspaceSource, timeoutMs: number): Promise<GitPullResult> {
  const cwd = spec.checkoutPath
  const result = await runGitAllowFail(['pull', '--ff-only', '--', 'origin', spec.branch], { cwd, timeoutMs })
  if (result.code !== 0) {
    const conflictedRaw = await runGitAllowFail(['diff', '--name-only', '--diff-filter=U'], { cwd, timeoutMs })
    const conflicted = conflictedRaw.stdout === '' ? [] : conflictedRaw.stdout.split('\n')
    if (conflicted.length > 0) return { conflicted }
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_GIT_FAILED',
      `git pull --ff-only failed: ${result.stderr || result.stdout}`,
    )
  }
  return { conflicted: [] }
}

/**
 * Check out `branch`, creating it from `origin/branch` when it is missing locally.
 * @param spec - git spec.
 * @param branch - branch to check out.
 * @param timeoutMs - subprocess timeout.
 */
export async function gitCheckoutBranch(
  spec: GitWorkspaceSource,
  branch: string,
  timeoutMs: number,
): Promise<void> {
  const cwd = spec.checkoutPath
  const local = await runGitAllowFail(['rev-parse', '--verify', '--', `refs/heads/${branch}`], { cwd, timeoutMs })
  if (local.code === 0) {
    await runGit(['checkout', branch], { cwd, timeoutMs })
    return
  }
  await runGit(['fetch', '--', 'origin', branch], { cwd, timeoutMs })
  await runGit(['checkout', '-B', branch, '--track', `origin/${branch}`], { cwd, timeoutMs })
}

async function existingCheckout(checkoutPath: string): Promise<string | undefined> {
  try {
    const path = await realpath(checkoutPath)
    if (!(await stat(path)).isDirectory()) {
      throw new WorkspaceSourceError(
        'WORKSPACE_SOURCE_PREPARE_FAILED',
        `git checkout path '${checkoutPath}' exists and is not a directory`,
      )
    }
    return path
  } catch (error) {
    if (error instanceof WorkspaceSourceError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return undefined
    throw error
  }
}

async function assertMatchingRemote(
  cwd: string,
  spec: GitWorkspaceSource,
  timeoutMs: number,
): Promise<void> {
  const origin = await runGitAllowFail(['remote', 'get-url', 'origin'], { cwd, timeoutMs })
  if (origin.code !== 0) {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_PREPARE_FAILED',
      `existing checkout '${cwd}' is not a git repository with origin`,
    )
  }
  if (!sameGitRemote(origin.stdout, spec.remoteUrl)) {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_PREPARE_FAILED',
      `existing checkout '${cwd}' origin is '${origin.stdout}', not '${spec.remoteUrl}'`,
    )
  }
}

function isAlreadyUpToDate(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`.toLowerCase()
  return text.includes('already up to date') || text.includes('already up-to-date')
}
