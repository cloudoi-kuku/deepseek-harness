/**
 * Git workspace-source provider: clone/fetch a remote into a checkout directory.
 * @module @deepseek-ai/dsh-workspace-source-git
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  GitWorkspaceSourceProvider,
  GitWorkspaceSpec,
  GitWorkspaceStatus,
  WorkspaceCheckout,
  WorkspaceSourceRequest,
  WorkspaceSpec,
} from '@deepseek-ai/dsh-workspace-source'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'

/**
 * Parse `owner/repo` from a GitHub https or ssh URL.
 * @param remoteUrl - clone URL without embedded credentials.
 * @returns owner and repo, or null when the URL is not a GitHub repo URL.
 */
export function parseGithubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const https = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(remoteUrl.trim())
  if (https?.[1] !== undefined && https[2] !== undefined) {
    return { owner: https[1], repo: https[2] }
  }
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(remoteUrl.trim())
  if (ssh?.[1] !== undefined && ssh[2] !== undefined) {
    return { owner: ssh[1], repo: ssh[2] }
  }
  return null
}

/**
 * Return the durable Git source spec for a GitHub remote or explicit owner/repo request.
 * @param request - must be kind git.
 * @returns spec with owner, repo, branch, and checkoutPath filled.
 */
export function resolveGit(request: WorkspaceSourceRequest): WorkspaceSpec {
  if (request.kind !== 'git') {
    throw new Error(`git workspace source cannot resolve kind '${request.kind}'`)
  }
  const parsed = parseGithubRemote(request.remoteUrl)
  const owner = request.owner ?? parsed?.owner
  const repo = request.repo ?? parsed?.repo
  if (owner === undefined || repo === undefined || owner === '' || repo === '') {
    throw new Error(`git workspace source cannot resolve owner/repo from '${request.remoteUrl}'`)
  }
  const branch = request.branch === undefined || request.branch === '' ? 'main' : request.branch
  const checkoutPath = join(request.checkoutParent, `${owner}-${repo}`)
  return {
    kind: 'git',
    provider: 'github',
    owner,
    repo,
    branch,
    remoteUrl: request.remoteUrl,
    checkoutPath,
    ...request.credentialId === undefined ? {} : { credentialId: request.credentialId },
  }
}

/**
 * Clone or fetch the spec's remote into checkoutPath.
 * @param spec - git spec.
 * @returns canonical cwd.
 */
export async function prepareGit(spec: WorkspaceSpec): Promise<WorkspaceCheckout> {
  if (spec.kind !== 'git') {
    throw new Error(`git workspace source cannot prepare kind '${spec.kind}'`)
  }
  await mkdir(dirname(spec.checkoutPath), { recursive: true })
  if (existsSync(join(spec.checkoutPath, '.git'))) {
    await runGit(spec.checkoutPath, ['remote', 'set-url', 'origin', spec.remoteUrl])
    await runGit(spec.checkoutPath, ['fetch', 'origin', spec.branch])
    await runGit(spec.checkoutPath, ['checkout', spec.branch]).catch(async () => {
      await runGit(spec.checkoutPath, ['checkout', '-B', spec.branch, `origin/${spec.branch}`])
    })
    try {
      await runGit(spec.checkoutPath, ['pull', '--ff-only', 'origin', spec.branch])
    } catch {
      // No upstream or non-ff: checkout already points at the fetched branch.
    }
  } else {
    try {
      await run('git', [
        'clone',
        '--branch',
        spec.branch,
        spec.remoteUrl,
        spec.checkoutPath,
      ])
    } catch {
      await run('git', ['clone', spec.remoteUrl, spec.checkoutPath])
      await runGit(spec.checkoutPath, ['checkout', '-B', spec.branch])
    }
  }
  const cwd = await realpathNormalize(spec.checkoutPath)
  if (!(await stat(cwd)).isDirectory()) {
    throw new Error(`cannot prepare a git workspace at '${cwd}': path is not a directory`)
  }
  return { cwd }
}

/**
 * Read the branch, dirtiness, and upstream distance of a checkout.
 * @param cwd - git checkout.
 * @returns dirty/branch projection.
 */
export async function gitStatus(cwd: string): Promise<GitWorkspaceStatus> {
  const branch = (await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  const porcelain = (await runGit(cwd, ['status', '--porcelain'])).stdout
  const dirty = porcelain.trim() !== ''
  let ahead = 0
  let behind = 0
  try {
    const counts = (await runGit(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])).stdout.trim()
    const [behindText, aheadText] = counts.split(/\s+/)
    behind = Number(behindText ?? 0)
    ahead = Number(aheadText ?? 0)
  } catch {
    // Detached or no upstream configured: ahead/behind stay 0.
  }
  return { branch, dirty, ahead, behind }
}

/**
 * Stage all changes and create a commit when the checkout has changes.
 * @param cwd - git checkout.
 * @param message - commit message.
 */
export async function gitCommit(cwd: string, message: string): Promise<void> {
  const trimmed = message.trim()
  if (trimmed === '') throw new Error('git commit requires a non-blank message')
  await runGit(cwd, ['add', '-A'])
  const status = await runGit(cwd, ['status', '--porcelain'])
  if (status.stdout.trim() === '') return
  await runGit(cwd, ['commit', '-m', trimmed])
}

/**
 * Push the current checkout HEAD to origin.
 * @param cwd - git checkout.
 */
export async function gitPush(cwd: string): Promise<void> {
  await runGit(cwd, ['push', 'origin', 'HEAD'])
}

/**
 * Fast-forward the checkout from origin HEAD.
 * @param cwd - git checkout.
 */
export async function gitPull(cwd: string): Promise<void> {
  await runGit(cwd, ['pull', '--ff-only', 'origin', 'HEAD'])
}

/**
 * Check out an existing branch, or create it when absent.
 * @param cwd - git checkout.
 * @param branch - branch name.
 */
export async function gitCheckoutBranch(cwd: string, branch: string): Promise<void> {
  try {
    await runGit(cwd, ['checkout', branch])
  } catch {
    await runGit(cwd, ['checkout', '-b', branch])
  }
}

const gitProvider: GitWorkspaceSourceProvider = {
  kind: 'git',
  resolve: resolveGit,
  prepare: prepareGit,
  status: gitStatus,
  commit: gitCommit,
  push: gitPush,
  pull: gitPull,
  checkoutBranch: gitCheckoutBranch,
}

/**
 * Registers the git provider on `ctx.workspaceSource`.
 */
export default class GitWorkspaceSource extends Service {
  static inject = ['workspaceSource']

  /**
   * @param ctx - host context with workspaceSource.
   */
  constructor(ctx: Context) {
    super(ctx, 'workspaceSourceGit')
    ctx.workspaceSource.register(gitProvider)
  }
}

function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return run('git', ['-C', cwd, ...args])
}

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(`${command} ${args[0] ?? ''} exited ${String(code)}: ${stderr.trim() || stdout.trim()}`))
    })
  })
}

export type { GitWorkspaceSpec }
