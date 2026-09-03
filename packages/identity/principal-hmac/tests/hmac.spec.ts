import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PrincipalService from '@deepseek-ai/dsh-principal'
import * as PrincipalHmac from '../src/index.ts'
import { signLaunchToken, validateLaunchToken } from '../src/index.ts'

const SECRET = 'test-hmac-secret'

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 600
}

describe('launch token', () => {
  it('round-trips tid/uid/product and rejects a bad signature or expiry', () => {
    const token = signLaunchToken({ tid: 't1', uid: 'u1', product: 'harness', exp: futureExp() }, SECRET)
    expect(validateLaunchToken(token, SECRET)).toMatchObject({ tid: 't1', uid: 'u1', product: 'harness' })
    expect(validateLaunchToken(token, 'other')).toBeNull()
    const expired = signLaunchToken({ tid: 't1', uid: 'u1', exp: Math.floor(Date.now() / 1000) - 1 }, SECRET)
    expect(validateLaunchToken(expired, SECRET)).toBeNull()
    expect(validateLaunchToken('not-a-token', SECRET)).toBeNull()
  })
})

describe('principal-hmac plugin', () => {
  it('rejects an empty secret at load', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    expect(() => PrincipalHmac.apply(ctx, { secret: '' }))
      .toThrow('principal-hmac: secret must be a non-empty string')
  })

  it('identifies cookie and Bearer tokens and clears the cookie on logout', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    PrincipalHmac.apply(ctx, { secret: SECRET, secureCookie: false })
    const token = signLaunchToken({ tid: 'tid-a', uid: 'uid-b', exp: futureExp() }, SECRET)
    const cookieReq = new Request('http://127.0.0.1/api/auth.me', {
      headers: { cookie: `harness_launch=${encodeURIComponent(token)}` },
    })
    await expect(ctx.principal.bindFromRequest(cookieReq)).resolves.toEqual({
      tenantId: 'tid-a',
      userId: 'uid-b',
      expiresAt: expect.any(Number),
    })
    const bearerReq = new Request('http://127.0.0.1/api/auth.me', {
      headers: { authorization: `Bearer ${token}` },
    })
    await expect(ctx.principal.bindFromRequest(bearerReq)).resolves.toMatchObject({
      tenantId: 'tid-a',
      userId: 'uid-b',
    })
    const logout = await ctx.principal.logout(cookieReq)
    expect(logout.setCookie).toEqual([
      'harness_launch=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    ])
  })

  it('ignores a token whose product does not match config.product', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    PrincipalHmac.apply(ctx, { secret: SECRET, product: 'harness' })
    const token = signLaunchToken({ tid: 't1', uid: 'u1', product: 'other', exp: futureExp() }, SECRET)
    const request = new Request('http://127.0.0.1/api/auth.me', {
      headers: { authorization: `Bearer ${token}` },
    })
    await expect(ctx.principal.bindFromRequest(request)).resolves.toBeUndefined()
  })
})
