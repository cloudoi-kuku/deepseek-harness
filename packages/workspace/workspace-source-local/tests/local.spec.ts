import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WorkspaceSource, { WorkspaceSourceError } from '@deepseek-ai/dsh-workspace-source'
import * as LocalSource from '../src/index.ts'

describe('workspace-source-local', () => {
  it('resolves and prepares an existing directory through realpath', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-ws-local-')))
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    await ctx.plugin(LocalSource)
    const spec = await ctx.workspaceSource.resolve({ kind: 'local', path: dir })
    expect(spec).toEqual({ kind: 'local', path: dir })
    await expect(ctx.workspaceSource.prepare(spec)).resolves.toEqual({ cwd: dir, spec })
  })

  it('rejects a missing path and a non-directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-ws-local-bad-'))
    const file = join(parent, 'file.txt')
    await writeFile(file, 'x')
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    await ctx.plugin(LocalSource)
    await expect(ctx.workspaceSource.resolve({ kind: 'local', path: join(parent, 'missing') }))
      .rejects.toBeInstanceOf(WorkspaceSourceError)
    await expect(ctx.workspaceSource.resolve({ kind: 'local', path: file }))
      .rejects.toMatchObject({ code: 'WORKSPACE_SOURCE_INVALID_REQUEST' })
    await mkdir(join(parent, 'ok'))
  })
})
