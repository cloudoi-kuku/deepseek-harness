import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WorkspaceSource, { WorkspaceSourceError } from '../src/index.ts'
import type { WorkspaceSourceProvider, WorkspaceSourceRequest, WorkspaceSourceSpec } from '../src/index.ts'

function localProvider(): WorkspaceSourceProvider {
  return {
    kind: 'local',
    async resolve(request: WorkspaceSourceRequest) {
      if (request.kind !== 'local') throw new Error('expected local')
      return { kind: 'local', path: request.path }
    },
    async prepare(spec: WorkspaceSourceSpec) {
      if (spec.kind !== 'local') throw new Error('expected local')
      return { cwd: spec.path, spec }
    },
  }
}

describe('WorkspaceSource registration', () => {
  it('registers a provider and unregisters it via the returned disposer', async () => {
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    const dispose = ctx.workspaceSource.register(localProvider())
    await expect(ctx.workspaceSource.resolve({ kind: 'local', path: '/tmp/a' }))
      .resolves.toEqual({ kind: 'local', path: '/tmp/a' })
    dispose()
    await expect(ctx.workspaceSource.resolve({ kind: 'local', path: '/tmp/a' }))
      .rejects.toMatchObject({ code: 'WORKSPACE_SOURCE_UNKNOWN_KIND' })
  })

  it('throws WORKSPACE_SOURCE_DUPLICATE_KIND on a second local provider', async () => {
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    ctx.workspaceSource.register(localProvider())
    expect(() => ctx.workspaceSource.register(localProvider()))
      .toThrow(expect.objectContaining({ code: 'WORKSPACE_SOURCE_DUPLICATE_KIND' }))
  })

  it('disposes provider registrations when the contributing fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.workspaceSource.register(localProvider())
    }, { inject: ['workspaceSource'] }))
    await expect(ctx.workspaceSource.prepare({ kind: 'local', path: '/tmp/a' }))
      .resolves.toEqual({ cwd: '/tmp/a', spec: { kind: 'local', path: '/tmp/a' } })
    await fiber.dispose()
    await expect(ctx.workspaceSource.prepare({ kind: 'local', path: '/tmp/a' }))
      .rejects.toBeInstanceOf(WorkspaceSourceError)
  })
})
