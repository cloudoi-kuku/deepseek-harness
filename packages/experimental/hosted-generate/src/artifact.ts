/** Collect a size-capped UTF-8 file map from a disposable workspace. */

import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { HostedGenerateError } from './error.ts'
import type { Config } from './types.ts'

/** Resolved collection limits used by {@link collectArtifact}. */
export interface ArtifactLimits {
  /** Total UTF-8 artifact budget. */
  maxArtifactBytes: number
  /** Maximum files retained. */
  maxFiles: number
  /** Maximum UTF-8 bytes of one retained file. */
  maxFileBytes: number
}

const SKIP_DIRECTORY_NAMES = new Set(['node_modules', '.git', '.sessions'])

/**
 * Read limits from validated hosted-generate config.
 * @param config - resolved service config.
 * @returns the collection limits.
 */
export function artifactLimits(config: Required<Pick<Config, 'maxArtifactBytes' | 'maxFiles' | 'maxFileBytes'>>): ArtifactLimits {
  return {
    maxArtifactBytes: config.maxArtifactBytes,
    maxFiles: config.maxFiles,
    maxFileBytes: config.maxFileBytes,
  }
}

/**
 * Walk `workspaceRoot` and return posix-relative UTF-8 files that fit the limits.
 * Hidden names, `node_modules`, `.git`, `.sessions`, binaries, and paths that
 * escape the workspace are omitted. Crossing the total byte or file cap fails.
 * @param workspaceRoot - absolute session workspace.
 * @param limits - collection caps.
 * @returns the file map.
 */
export async function collectArtifact(
  workspaceRoot: string,
  limits: ArtifactLimits,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  let totalBytes = 0
  const entries = await readdir(workspaceRoot, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const relativeDir = entry.parentPath === workspaceRoot
      ? ''
      : relative(workspaceRoot, entry.parentPath)
    /* v8 ignore next -- recursive readdir stays under workspaceRoot except a directory symlink escape. */
    if (relativeDir.startsWith('..') || isAbsolute(relativeDir)) continue
    const parts = relativeDir === '' ? [] : relativeDir.split(sep)
    if (parts.some(part => part.startsWith('.') || SKIP_DIRECTORY_NAMES.has(part))) continue
    if (entry.name.startsWith('.')) continue
    const relativePath = [...parts, entry.name].join('/')
    /* v8 ignore next -- readdir never yields an empty name or a NUL component. */
    if (relativePath === '' || relativePath.includes('\0')) continue
    const absolutePath = `${entry.parentPath}${sep}${entry.name}`
    const bytes = await readFile(absolutePath)
    if (bytes.byteLength > limits.maxFileBytes) {
      throw new HostedGenerateError(
        'GENERATE_TOO_LARGE',
        `file ${relativePath} exceeds maxFileBytes`,
      )
    }
    let text: string
    try {
      text = new TextDecoder('utf8', { fatal: true }).decode(bytes)
    } catch {
      continue
    }
    const size = Buffer.byteLength(text, 'utf8')
    if (Object.keys(files).length >= limits.maxFiles) {
      throw new HostedGenerateError('GENERATE_TOO_LARGE', 'artifact exceeds maxFiles')
    }
    if (totalBytes + size > limits.maxArtifactBytes) {
      throw new HostedGenerateError('GENERATE_TOO_LARGE', 'artifact exceeds maxArtifactBytes')
    }
    files[relativePath] = text
    totalBytes += size
  }
  return files
}
