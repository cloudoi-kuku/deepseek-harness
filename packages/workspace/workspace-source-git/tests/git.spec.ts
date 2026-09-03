import { afterEach, describe, expect, it } from 'vitest'
import { execFile as execFileCb } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import WorkspaceSource, { WorkspaceSourceError } from '@deepseek-ai/dsh-workspace-source'
import * as GitSource from '../src/index.ts'
import { parseGitRemote } from '../src/index.ts'

const execFile = promisify(execFileCb)
const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(name: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `dsh-ws-git-${name}-`)))
  tempDirs.push(dir)
  return dir
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFile('git', args, { cwd })
}

async function initOrigin(parent: string, owner: string, repo: string): Promise<string> {
  const dir = join(parent, owner, repo)
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.email', 'git@test'])
  await git(dir, ['config', 'user.name', 'git-test'])
  await writeFile(join(dir, 'README.md'), 'hello\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'init'])
  return dir
}

describe('parseGitRemote', () => {
  it('parses GitHub HTTPS and SSH URLs', () => {
    expect(parseGitRemote('https://github.com/acme/demo.git')).toEqual({
      provider: 'github', owner: 'acme', repo: 'demo',
    })
    expect(parseGitRemote('git@github.com:acme/demo.git')).toEqual({
      provider: 'github', owner: 'acme', repo: 'demo',
    })
  })

  it('parses a generic path-shaped remote and rejects traversal', () => {
    expect(parseGitRemote('/tmp/acme/demo.git')).toEqual({
      provider: 'generic', owner: 'acme', repo: 'demo',
    })
    expect(() => parseGitRemote('https://github.com/acme/../demo.git')).toThrow(WorkspaceSourceError)
    expect(() => parseGitRemote('')).toThrow(/non-empty/)
  })
})

describe('workspace-source-git', () => {
  it('clones, reports clean status, commits a dirty tree, and pulls fast-forward', async () => {
    const root = await tempDir('root')
    const origin = await initOrigin(root, 'acme', 'demo')
    const parent = join(root, 'checkouts')
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    await ctx.plugin(GitSource)
    const spec = await ctx.workspaceSource.resolve({
      kind: 'git',
      remoteUrl: origin,
      checkoutParent: parent,
    })
    expect(spec.kind).toBe('git')
    if (spec.kind !== 'git') throw new Error('expected git spec')
    expect(spec).toMatchObject({
      provider: 'generic', owner: 'acme', repo: 'demo', branch: 'main', remoteUrl: origin,
    })
    expect(spec).not.toHaveProperty('token')

    const checkout = await ctx.workspaceSource.prepare(spec)
    const prepared = checkout.spec
    if (prepared.kind !== 'git') throw new Error('expected git spec')
    const status = await ctx.workspaceSource.status(prepared)
    expect(status).toMatchObject({ branch: 'main', dirty: false, conflicted: [] })

    await writeFile(join(checkout.cwd, 'note.txt'), 'dirty\n')
    expect((await ctx.workspaceSource.status(prepared)).dirty).toBe(true)
    await git(checkout.cwd, ['config', 'user.email', 'git@test'])
    await git(checkout.cwd, ['config', 'user.name', 'git-test'])
    const committed = await ctx.workspaceSource.commit(prepared, 'add note')
    expect(committed.commit).toMatch(/^[0-9a-f]{40}$/)
    expect((await ctx.workspaceSource.status(prepared)).dirty).toBe(false)

    const again = await ctx.workspaceSource.prepare(prepared)
    expect(again.cwd).toBe(checkout.cwd)
  })
})
