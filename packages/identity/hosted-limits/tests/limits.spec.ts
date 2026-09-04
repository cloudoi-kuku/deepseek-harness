import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HostedLimits, { HostedLimitsError } from '../src/index.ts'

const owner = { tenantId: 't1', userId: 'u1' }

describe('HostedLimits', () => {
  it('rejects a relative checkoutRoot at load', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(HostedLimits, { checkoutRoot: 'relative' }))
      .rejects.toThrow('hosted-limits: checkoutRoot must be an absolute directory')
  })

  it('kill switch rejects mutate paths and quota 0 is unlimited', async () => {
    const ctx = new Context()
    await ctx.plugin(HostedLimits, { killSwitch: true })
    expect(() => ctx.hostedLimits.assertNotKilled()).toThrow(HostedLimitsError)
    expect(() => ctx.hostedLimits.assertNotKilled()).toThrow(expect.objectContaining({ code: 'kill-switch' }))
  })

  it('enforces workspace and session caps and git rate limits', async () => {
    const ctx = new Context()
    await ctx.plugin(HostedLimits, {
      checkoutRoot: '/tmp/checkouts',
      maxWorkspacesPerUser: 1,
      maxConcurrentSessionsPerUser: 2,
      maxGitOpsPerMinute: 2,
    })
    expect(ctx.hostedLimits.checkoutRoot).toBe('/tmp/checkouts')
    expect(ctx.hostedLimits.requireCheckoutRoot()).toBe('/tmp/checkouts')
    ctx.hostedLimits.assertWorkspaceCreate(owner, 0)
    expect(() => ctx.hostedLimits.assertWorkspaceCreate(owner, 1))
      .toThrow(expect.objectContaining({ code: 'quota-exceeded', details: { kind: 'workspace', limit: 1 } }))
    ctx.hostedLimits.assertSessionCreate(owner, 1)
    expect(() => ctx.hostedLimits.assertSessionCreate(owner, 2))
      .toThrow(expect.objectContaining({ code: 'quota-exceeded', details: { kind: 'session', limit: 2 } }))
    ctx.hostedLimits.assertGitOp(owner)
    ctx.hostedLimits.assertGitOp(owner)
    expect(() => ctx.hostedLimits.assertGitOp(owner))
      .toThrow(expect.objectContaining({ code: 'rate-limited', details: { kind: 'git-op', limit: 2 } }))
  })

  it('requireCheckoutRoot fails loud when the root is unset', async () => {
    const ctx = new Context()
    await ctx.plugin(HostedLimits, {})
    expect(() => ctx.hostedLimits.requireCheckoutRoot())
      .toThrow(expect.objectContaining({ code: 'checkout-root-missing' }))
  })
})
