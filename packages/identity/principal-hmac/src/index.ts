/**
 * HMAC CoreNet launch-token authenticator for `ctx.principal`. Cookie name
 * `harness_launch` and the payload/signature algorithm match the hosted
 * overlay; this plugin re-validates inside dsh rather than trusting proxy
 * headers. Default `dsh web` does not mount it.
 * @module @deepseek-ai/dsh-principal-hmac
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Principal, PrincipalAuthenticator } from '@deepseek-ai/dsh-principal'
import { launchTokenFromRequest, validateLaunchToken } from './token.ts'

export { launchTokenFromRequest, signLaunchToken, validateLaunchToken } from './token.ts'
export type { LaunchTokenClaims } from './token.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'principal-hmac'

/** The principal seam this authenticator registers into. */
export const inject = ['principal']

/** Plugin config: HMAC secret and cookie flags. */
export interface Config {
  /** HMAC secret shared with CoreNet / the overlay proxy. Empty rejects at load. */
  secret: string
  /** Cookie name; overlay uses `harness_launch`. */
  cookieName?: string
  /** Whether logout/set cookies include `Secure`. Default true. */
  secureCookie?: boolean
  /** When set, claims.product must equal this value. */
  product?: string
}

export const Config: z<Config> = z.object({
  secret: z.string(),
  cookieName: z.string().default('harness_launch'),
  secureCookie: z.boolean().default(true),
  product: z.string(),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Config & { cookieName: string; secureCookie: boolean }

/**
 * Register the HMAC authenticator with `ctx.principal`.
 * @param ctx - context that already provides `principal`.
 * @param config - secret and cookie flags; schemastery fills defaults.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    secret: config.secret,
    cookieName: config.cookieName ?? 'harness_launch',
    secureCookie: config.secureCookie ?? true,
    ...config.product === undefined ? {} : { product: config.product },
  }
  if (resolved.secret === '') {
    throw new Error('principal-hmac: secret must be a non-empty string')
  }
  if (resolved.cookieName === '') {
    throw new Error('principal-hmac: cookieName must be a non-empty string')
  }
  ctx.principal.register(createHmacAuthenticator(resolved))
}

function createHmacAuthenticator(config: ResolvedConfig): PrincipalAuthenticator {
  return {
    id: 'hmac-launch',
    identify(request) {
      const token = launchTokenFromRequest(request, config.cookieName)
      const claims = validateLaunchToken(token, config.secret)
      if (claims === null) return undefined
      if (config.product !== undefined && claims.product !== config.product) return undefined
      const principal: Principal = {
        tenantId: claims.tid,
        userId: claims.uid,
        expiresAt: claims.exp,
        ...claims.product === undefined ? {} : { product: claims.product },
      }
      return principal
    },
    logout() {
      const secure = config.secureCookie ? '; Secure' : ''
      return {
        setCookie: [
          `${config.cookieName}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`,
        ],
      }
    },
  }
}
