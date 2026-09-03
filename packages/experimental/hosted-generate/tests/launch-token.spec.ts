import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MAXIMUM_LIFETIME_S, validateLaunchToken } from '../example/azure/launch-token.mjs'

const SECRET = 'test-secret-value'

function tokenWithExp(exp: number, extra: Record<string, unknown> = {}): string {
  const payload = Buffer.from(JSON.stringify({
    tid: '11111111-1111-1111-1111-111111111111',
    uid: '22222222-2222-2222-2222-222222222222',
    product: 'corenet',
    exp,
    ...extra,
  })).toString('base64url')
  const signature = createHmac('sha256', SECRET).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

describe('validateLaunchToken', () => {
  it('accepts tid/uid/exp and ignores a leftover email field', () => {
    const token = tokenWithExp(Math.floor(Date.now() / 1000) + 300, { email: 'ada@cloudoi.io' })
    const claims = validateLaunchToken(token, SECRET)
    expect(claims?.tid).toBe('11111111-1111-1111-1111-111111111111')
    expect(claims?.uid).toBe('22222222-2222-2222-2222-222222222222')
  })

  it('is reusable until expiry', () => {
    const token = tokenWithExp(Math.floor(Date.now() / 1000) + 300)
    expect(validateLaunchToken(token, SECRET)).not.toBeNull()
    expect(validateLaunchToken(token, SECRET)).not.toBeNull()
  })

  it('rejects a token claiming longer than MaximumLifetime', () => {
    const token = tokenWithExp(Math.floor(Date.now() / 1000) + MAXIMUM_LIFETIME_S + 60)
    expect(validateLaunchToken(token, SECRET)).toBeNull()
  })
})
