/**
 * HMAC launch token shared with CoreNet HarnessLaunchToken.
 * Binds a harness session to a CoreNet/Hosting account; it is not a second login.
 * Reusable until exp (cookie + CoreNet from-harness Bearer). Email is not a claim.
 */

import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto'

/** Matches CoreNet `HarnessLaunchToken.MaximumLifetime`. */
export const MAXIMUM_LIFETIME_S = 10 * 60

/**
 * @param {string} token
 * @param {string} secret
 * @returns {{ tid: string, uid: string, product?: string, exp: number, brief?: string } | null}
 */
export function validateLaunchToken(token, secret) {
  if (!token || !secret) return null
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const payload = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  const expected = b64url(createHmac('sha256', secret).update(payload).digest())
  if (!fixedEqual(expected, signature)) return null
  try {
    const claims = JSON.parse(Buffer.from(pad(payload), 'base64').toString('utf8'))
    if (!claims?.tid || !claims?.uid) return null
    if (typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000) return null
    if (claims.exp > Date.now() / 1000 + MAXIMUM_LIFETIME_S) return null
    return claims
  } catch {
    return null
  }
}

/** @param {import('node:http').IncomingMessage} req */
export function launchTokenFromRequest(req) {
  const cookie = req.headers.cookie ?? ''
  const match = /(?:^|;\s*)harness_launch=([^;]+)/.exec(cookie)
  if (match?.[1]) return decodeURIComponent(match[1])
  const auth = req.headers.authorization ?? ''
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
  return ''
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function pad(value) {
  const base = value.replace(/-/g, '+').replace(/_/g, '/')
  const rem = base.length % 4
  return rem === 0 ? base : base + '='.repeat(4 - rem)
}

function fixedEqual(a, b) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return cryptoTimingSafeEqual(left, right)
}
