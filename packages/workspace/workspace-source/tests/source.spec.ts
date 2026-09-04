import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WorkspaceSource from '../src/index.ts'
import type { WorkspaceSourceProvider, WorkspaceSourceRequest, WorkspaceSpec } from '../src/index.ts'

function localProvider(): WorkspaceSourceProvider {
  return {
    kind: 'local',
    resolve(request: WorkspaceSourceRequest): WorkspaceSpec {
      if (request.kind !== 'local') throw new Error('expected local')
      return { kind: 'local', path: request.path }
    },
    prepare(spec: WorkspaceSpec) {
      if (spec.kind !== 'local') throw new Error('expected local')
      return Promise.resolve({ cwd: spec.path })
    },
  }
}

describe('WorkspaceSource registration', () => {
  it('registers a provider and unregisters it via the returned disposer', async () => {
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    const dispose = ctx.workspaceSource.register(localProvider())
    expect(ctx.workspaceSource.resolve({ kind: 'local', path: '/tmp/a' }))
      .toEqual({ kind: 'local', path: '/tmp/a' })
    dispose()
    expect(() => ctx.workspaceSource.resolve({ kind: 'local', path: '/tmp/a' }))
      .toThrow(/kind 'local' is not registered/)
  })

  it('throws on a duplicate kind', async () => {
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    ctx.workspaceSource.register(localProvider())
    expect(() => ctx.workspaceSource.register(localProvider()))
      .toThrow(/kind 'local' is already registered/)
  })

  it('disposes provider registrations when the contributing fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(WorkspaceSource)
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.workspaceSource.register(localProvider())
    }, { inject: ['workspaceSource'] }))
    await expect(ctx.workspaceSource.prepare({ kind: 'local', path: '/tmp/a' }))
      .resolves.toEqual({ cwd: '/tmp/a' })
    await fiber.dispose()
    expect(() => ctx.workspaceSource.resolve({ kind: 'local', path: '/tmp/a' }))
      .toThrow(/kind 'local' is not registered/)
  })
})
