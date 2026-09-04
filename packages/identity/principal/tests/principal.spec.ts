import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PrincipalService, { PrincipalUnauthenticatedError } from '../src/index.ts'
import type { Principal, PrincipalAuthenticator } from '../src/index.ts'

const alice: Principal = { tenantId: 't1', userId: 'u1' }
const bob: Principal = { tenantId: 't2', userId: 'u2', product: 'harness' }

function cookieAuth(id: string, principal: Principal | undefined): PrincipalAuthenticator {
  return {
    id,
    identify(request) {
      return request.headers.get('x-test-auth') === id ? principal : undefined
    },
    logout() {
      return { setCookie: [`${id}=; Max-Age=0; Path=/`] }
    },
  }
}

describe('PrincipalService', () => {
  it('current() is undefined outside run and returns the bound principal inside it', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    expect(ctx.principal.current()).toBeUndefined()
    expect(ctx.principal.run(alice, () => ctx.principal.current())).toEqual(alice)
    expect(ctx.principal.current()).toBeUndefined()
  })

  it('require() rejects when no principal is bound', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    expect(() => ctx.principal.require('list workspaces')).toThrow(PrincipalUnauthenticatedError)
    expect(ctx.principal.run(alice, () => ctx.principal.require('list workspaces'))).toEqual(alice)
  })

  it('nested run replaces the store for the inner continuation', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    const seen = ctx.principal.run(alice, () => {
      const outer = ctx.principal.current()
      const inner = ctx.principal.run(bob, () => ctx.principal.current())
      const restored = ctx.principal.current()
      return { outer, inner, restored }
    })
    expect(seen).toEqual({ outer: alice, inner: bob, restored: alice })
  })

  it('concurrent run continuations do not share a store', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
    const [left, right] = await Promise.all([
      ctx.principal.run(alice, async () => {
        await delay(20)
        return ctx.principal.current()
      }),
      ctx.principal.run(bob, async () => {
        await delay(5)
        return ctx.principal.current()
      }),
    ])
    expect(left).toEqual(alice)
    expect(right).toEqual(bob)
  })

  it('bindFromRequest returns the first matching authenticator and logout merges cookies', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    ctx.principal.register(cookieAuth('a', undefined))
    ctx.principal.register(cookieAuth('b', bob))
    expect(ctx.principal.hasAuthenticators()).toBe(true)
    const miss = new Request('http://127.0.0.1/api/auth.me')
    await expect(ctx.principal.bindFromRequest(miss)).resolves.toBeUndefined()
    const hit = new Request('http://127.0.0.1/api/auth.me', { headers: { 'x-test-auth': 'b' } })
    await expect(ctx.principal.bindFromRequest(hit)).resolves.toEqual(bob)
    await expect(ctx.principal.logout(miss)).resolves.toEqual({
      setCookie: ['a=; Max-Age=0; Path=/', 'b=; Max-Age=0; Path=/'],
    })
  })

  it('register rejects a duplicate authenticator id and the disposer unregisters', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    const dispose = ctx.principal.register(cookieAuth('a', alice))
    expect(() => ctx.principal.register(cookieAuth('a', bob)))
      .toThrow('a principal authenticator for id "a" is already registered')
    dispose()
    expect(ctx.principal.hasAuthenticators()).toBe(false)
    ctx.principal.register(cookieAuth('a', bob))
    const hit = new Request('http://127.0.0.1/api/auth.me', { headers: { 'x-test-auth': 'a' } })
    await expect(ctx.principal.bindFromRequest(hit)).resolves.toEqual(bob)
  })
})
