/**
 * Caller identity and authenticator contracts for `ctx.principal`.
 * @module @deepseek-ai/dsh-principal/src/types
 */

/**
 * Authenticated product caller. `tenantId` and `userId` are opaque CoreNet or
 * issuer ids, never emails. Tokens are never stored here.
 */
export interface Principal {
  /** Tenant / organization id from the issuer (`tid` on the HMAC launch token). */
  readonly tenantId: string
  /** User id from the issuer (`uid` on the HMAC launch token). */
  readonly userId: string
  /** Optional product id the token is scoped to. */
  readonly product?: string | undefined
  /** Unix-seconds expiry copied from the token when the issuer supplies one. */
  readonly expiresAt?: number | undefined
}

/** Cookie or header values an authenticator wants the HTTP carrier to emit. */
export interface PrincipalLogout {
  /** `Set-Cookie` header values (HttpOnly clears). Omitted when nothing to clear. */
  readonly setCookie?: readonly string[] | undefined
}

/**
 * One identification strategy (HMAC cookie, later OAuth). Providers register
 * into `ctx.principal`; the definition never imports them.
 */
export interface PrincipalAuthenticator {
  /** Registry key; duplicates throw at register. */
  readonly id: string
  /**
   * Identify the caller from cookies or Authorization. Return `undefined`
   * when this authenticator does not apply or the token is invalid/expired.
   * @param request - inbound WHATWG Request.
   * @returns the caller, or `undefined` to try the next authenticator.
   */
  identify(request: Request): Principal | undefined | Promise<Principal | undefined>
  /**
   * Optional logout side effects for this authenticator.
   * @param request - inbound request.
   * @returns cookies to set; omitted when this authenticator has none.
   */
  logout?(request: Request): PrincipalLogout | Promise<PrincipalLogout>
}
