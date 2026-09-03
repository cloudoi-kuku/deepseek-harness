/**
 * Git subprocess helpers for workspace-source-git. Invokes the `git` binary
 * with prompts disabled so a missing credential fails instead of hanging.
 * @module @deepseek-ai/dsh-workspace-source-git/src/git
 */

import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { WorkspaceSourceError } from '@deepseek-ai/dsh-workspace-source'

const execFile = promisify(execFileCb)

/** Env that refuses interactive credential prompts. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'echo',
  GCM_INTERACTIVE: 'never',
}

/**
 * Run `git` with the given args. Nonzero exits become
 * {@link WorkspaceSourceError} `WORKSPACE_SOURCE_GIT_FAILED`.
 * @param args - git argv after the binary name.
 * @param options - working directory and timeout.
 * @returns UTF-8 stdout, trimmed.
 */
export async function runGit(
  args: readonly string[],
  options: { cwd?: string; timeoutMs: number },
): Promise<string> {
  try {
    const { stdout } = await execFile('git', [...args], {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      encoding: 'utf8',
      env: GIT_ENV,
    })
    return stdout.trim()
  } catch (error) {
    const detail = gitFailure(error)
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_GIT_FAILED',
      `git ${args.join(' ')} failed: ${detail}`,
      { cause: error },
    )
  }
}

/**
 * Run `git` and resolve with stdout even when the process exits nonzero.
 * @param args - git argv after the binary name.
 * @param options - working directory and timeout.
 * @returns stdout, stderr, and the numeric exit code.
 */
export async function runGitAllowFail(
  args: readonly string[],
  options: { cwd?: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFile('git', [...args], {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      encoding: 'utf8',
      env: GIT_ENV,
    })
    return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 }
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
      code?: number | string
    }
    if (typeof failure.code === 'number') {
      return {
        stdout: String(failure.stdout ?? '').trim(),
        stderr: String(failure.stderr ?? '').trim(),
        code: failure.code,
      }
    }
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_GIT_FAILED',
      `git ${args.join(' ')} failed: ${gitFailure(error)}`,
      { cause: error },
    )
  }
}

function gitFailure(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const failure = error as { stderr?: string; message?: string }
    if (typeof failure.stderr === 'string' && failure.stderr.trim() !== '') return failure.stderr.trim()
    if (typeof failure.message === 'string') return failure.message
  }
  return String(error)
}
