import { afterEach, describe, expect, it } from 'vitest'
import { execFile as execFileCb } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import WorkspaceSource from '@deepseek-ai/dsh-workspace-source'
import GitWorkspaceSource, { parseGithubRemote } from '../src/index.ts'

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

async function initOrigin(parent: string): Promise<string> {
  const dir = join(parent, 'origin')
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.email', 'git@test'])
  await git(dir, ['config', 'user.name', 'git-test'])
  await writeFile(join(dir, 'README.md'), 'hello\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'init'])
  return dir
}

describe('parseGithubRemote', () => {
  it('parses GitHub HTTPS and SSH URLs', () => {
    expect(parseGithubRemote('https://github.com/acme/demo.git')).toEqual({
      owner: 'acme', repo: 'demo',
    })
    expect(parseGithubRemote('git@github.com:acme/demo.git')).toEqual({
      owner: 'acme', repo: 'demo',
    })
    expect(parseGithubRemote('/tmp/not-github')).toBeNull()
  })
})

describe('workspace-source-git', () => {
  it('clones, reports clean status, commits a dirty tree, and never stores a token', async () => {
    const root = await tempDir('root')
    const origin = await initOrigin(root)
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    await ctx.plugin(GitWorkspaceSource)
    const spec = ctx.workspaceSource.resolve({
      kind: 'git',
      provider: 'github',
      remoteUrl: origin,
      checkoutParent: join(root, 'checkouts'),
      owner: 'acme',
      repo: 'demo',
    })
    expect(spec.kind).toBe('git')
    if (spec.kind !== 'git') throw new Error('expected git spec')
    expect(spec).toMatchObject({
      provider: 'github', owner: 'acme', repo: 'demo', branch: 'main', remoteUrl: origin,
    })
    expect(spec).not.toHaveProperty('token')

    const checkout = await ctx.workspaceSource.prepare(spec)
    const status = await ctx.workspaceSource.git().status(checkout.cwd)
    expect(status).toMatchObject({ branch: 'main', dirty: false })

    await writeFile(join(checkout.cwd, 'note.txt'), 'dirty\n')
    expect((await ctx.workspaceSource.git().status(checkout.cwd)).dirty).toBe(true)
    await git(checkout.cwd, ['config', 'user.email', 'git@test'])
    await git(checkout.cwd, ['config', 'user.name', 'git-test'])
    await ctx.workspaceSource.git().commit(checkout.cwd, 'add note')
    expect((await ctx.workspaceSource.git().status(checkout.cwd)).dirty).toBe(false)

    const again = await ctx.workspaceSource.prepare(spec)
    expect(again.cwd).toBe(checkout.cwd)
  })
})
