/**
 * HMAC launch token compatible with CoreNet HarnessLaunchToken and the
 * hosted overlay's `launch-token.mjs`. Payload is `{ tid, uid, product?, exp }`.
 * @module @deepseek-ai/dsh-principal-hmac/src/token
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Claims carried by a valid launch token. Email is never required or stored. */
export interface LaunchTokenClaims {
  /** Tenant id. */
  readonly tid: string
  /** User id. */
  readonly uid: string
  /** Optional product scope. */
  readonly product?: string | undefined
  /** Unix-seconds expiry; the token is rejected at or after this instant. */
  readonly exp: number
}

/**
 * Sign CoreNet-compatible launch claims.
 * @param claims - tid/uid/exp and optional product.
 * @param secret - HMAC secret; must be non-empty.
 * @returns `payload.signature` token string.
 */
export function signLaunchToken(claims: LaunchTokenClaims, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify({
    tid: claims.tid,
    uid: claims.uid,
    exp: claims.exp,
    ...claims.product === undefined ? {} : { product: claims.product },
  }), 'utf8'))
  const signature = b64url(createHmac('sha256', secret).update(payload).digest())
  return `${payload}.${signature}`
}

/**
 * Validate a CoreNet launch token. Invalid, truncated, or expired tokens
 * return `null` rather than throwing so authenticators can fall through.
 * @param token - `payload.signature` string from cookie or Bearer.
 * @param secret - HMAC secret.
 * @returns claims when the signature matches and `exp` is still in the future.
 */
export function validateLaunchToken(token: string, secret: string): LaunchTokenClaims | null {
  if (token === '' || secret === '') return null
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const payload = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  const expected = b64url(createHmac('sha256', secret).update(payload).digest())
  if (!fixedEqual(expected, signature)) return null
  try {
    const claims = JSON.parse(Buffer.from(pad(payload), 'base64').toString('utf8')) as {
      tid?: unknown
      uid?: unknown
      product?: unknown
      exp?: unknown
    }
    if (typeof claims.tid !== 'string' || claims.tid === '') return null
    if (typeof claims.uid !== 'string' || claims.uid === '') return null
    if (typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000) return null
    if (claims.product !== undefined && typeof claims.product !== 'string') return null
    return {
      tid: claims.tid,
      uid: claims.uid,
      exp: claims.exp,
      ...typeof claims.product === 'string' ? { product: claims.product } : {},
    }
  } catch {
    return null
  }
}

/**
 * Read the launch token from `Cookie` or `Authorization: Bearer`.
 * @param request - inbound WHATWG Request.
 * @param cookieName - cookie to parse (overlay uses `harness_launch`).
 * @returns the raw token string, or `''` when absent.
 */
export function launchTokenFromRequest(request: Request, cookieName: string): string {
  const cookie = request.headers.get('cookie') ?? ''
  const match = new RegExp(`(?:^|;\\s*)${escapeRegExp(cookieName)}=([^;]+)`).exec(cookie)
  if (match?.[1] !== undefined) return decodeURIComponent(match[1])
  const auth = request.headers.get('authorization') ?? ''
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
  return ''
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function pad(value: string): string {
  const base = value.replace(/-/g, '+').replace(/_/g, '/')
  const rem = base.length % 4
  return rem === 0 ? base : base + '='.repeat(4 - rem)
}

function fixedEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
