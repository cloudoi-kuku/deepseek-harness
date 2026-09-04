import { describe, expect, it } from 'vitest'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WorkspaceSource from '@deepseek-ai/dsh-workspace-source'
import LocalWorkspaceSource from '../src/index.ts'

describe('workspace-source-local', () => {
  it('prepares an existing directory through realpath', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-ws-local-')))
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    await ctx.plugin(LocalWorkspaceSource)
    const spec = ctx.workspaceSource.resolve({ kind: 'local', path: dir })
    expect(spec).toEqual({ kind: 'local', path: dir })
    await expect(ctx.workspaceSource.prepare(spec)).resolves.toEqual({ cwd: dir })
  })

  it('rejects a missing path and a non-directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-ws-local-bad-'))
    const file = join(parent, 'file.txt')
    await writeFile(file, 'x')
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    await ctx.plugin(LocalWorkspaceSource)
    await expect(ctx.workspaceSource.prepare({ kind: 'local', path: join(parent, 'missing') }))
      .rejects.toThrow()
    await expect(ctx.workspaceSource.prepare({ kind: 'local', path: file }))
      .rejects.toThrow(/not a directory/)
  })
})
