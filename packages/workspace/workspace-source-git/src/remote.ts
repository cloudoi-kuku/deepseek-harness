/**
 * Git remote URL parsing for workspace-source-git.
 * @module @deepseek-ai/dsh-workspace-source-git/src/remote
 */

import { WorkspaceSourceError } from '@deepseek-ai/dsh-workspace-source'
import type { GitWorkspaceProvider } from '@deepseek-ai/dsh-workspace-source'

/** Owner/repo segment: no slashes or parent traversal. */
const SEGMENT = /^[A-Za-z0-9._-]+$/

const GITHUB_HTTPS = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i
const GITHUB_SSH = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i
const GENERIC_TAIL = /(?:^|[:/])([^/:]+)\/([^/]+?)(?:\.git)?\/?$/

/** Owner and repository parsed from a clone URL. */
export interface ParsedGitRemote {
  readonly provider: GitWorkspaceProvider
  readonly owner: string
  readonly repo: string
}

/**
 * Parse a Git clone URL into provider/owner/repo. GitHub HTTPS and SSH forms
 * record `provider: 'github'`; every other URL uses the last two path
 * segments as owner/repo with `provider: 'generic'`.
 * @param remoteUrl - clone URL (HTTPS, SSH, or `file:`).
 * @returns provider, owner, and repository name without a `.git` suffix.
 */
export function parseGitRemote(remoteUrl: string): ParsedGitRemote {
  const trimmed = remoteUrl.trim()
  if (trimmed === '') {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_INVALID_REQUEST',
      'git workspace remoteUrl must be a non-empty clone URL',
    )
  }
  const github = trimmed.match(GITHUB_HTTPS) ?? trimmed.match(GITHUB_SSH)
  if (github !== null) {
    return {
      provider: 'github',
      owner: requireSegment(github[1] as string, 'owner', trimmed),
      repo: requireSegment(github[2] as string, 'repo', trimmed),
    }
  }
  const generic = trimmed.match(GENERIC_TAIL)
  if (generic === null) {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_INVALID_REQUEST',
      `cannot parse owner/repo from git remote '${trimmed}'`,
    )
  }
  return {
    provider: 'generic',
    owner: requireSegment(generic[1] as string, 'owner', trimmed),
    repo: requireSegment(generic[2] as string, 'repo', trimmed),
  }
}

/**
 * Whether two clone URLs name the same remote after dropping an optional
 * trailing `.git` and a trailing slash.
 * @param left - first URL.
 * @param right - second URL.
 * @returns true when the normalized spellings are equal.
 */
export function sameGitRemote(left: string, right: string): boolean {
  return normalizeRemote(left) === normalizeRemote(right)
}

function requireSegment(value: string, label: string, remoteUrl: string): string {
  if (!SEGMENT.test(value) || value === '.' || value === '..') {
    throw new WorkspaceSourceError(
      'WORKSPACE_SOURCE_INVALID_REQUEST',
      `git remote '${remoteUrl}' has an invalid ${label} '${value}'`,
    )
  }
  return value
}

function normalizeRemote(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\.git$/i, '')
}
