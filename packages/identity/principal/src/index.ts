/**
 * Service Definition for the product principal (`ctx.principal`): authenticators
 * identify a caller from an HTTP request, and `run` binds that caller for the
 * remainder of the async continuation. Unmounted compositions have no principal;
 * a mounted service with zero authenticators is the same as unmounted for
 * authorization (OSS `dsh web`). Tokens never live on this service.
 * @module @deepseek-ai/dsh-principal
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { Context, Service } from '@deepseek-ai/cordis'

export type { Principal, PrincipalAuthenticator, PrincipalLogout } from './types.ts'
import type { Principal, PrincipalAuthenticator, PrincipalLogout } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    principal: PrincipalService
  }
}

/** No authenticator accepted the request, or `current()` was read outside `run`. */
export class PrincipalUnauthenticatedError extends Error {
  /**
   * @param action - the operation that needed a caller.
   */
  constructor(readonly action: string) {
    super(`cannot ${action}: no authenticated principal is bound to this request`)
    this.name = 'PrincipalUnauthenticatedError'
  }
}

const storage = new AsyncLocalStorage<Principal | undefined>()

/**
 * Request-scoped caller registry. Load one instance per context as
 * `ctx.principal`; authenticators register into it. The default web-app
 * composition does not mount this service.
 */
export class PrincipalService extends Service {
  private readonly authenticators = new Map<string, PrincipalAuthenticator>()

  /**
   * @param ctx - Cordis context this service is installed on.
   */
  constructor(ctx: Context) {
    super(ctx, 'principal')
  }

  /**
   * Register one authenticator. A duplicate `id` throws. The disposer
   * unregisters on fiber disposal.
   * @param authenticator - implementation that reads cookies or headers.
   * @returns the disposer that unregisters the authenticator.
   */
  register(authenticator: PrincipalAuthenticator): () => void {
    if (this.authenticators.has(authenticator.id)) {
      throw new Error(`a principal authenticator for id "${authenticator.id}" is already registered`)
    }
    const authenticators = this.authenticators
    const dispose = this.ctx.effect(function* () {
      authenticators.set(authenticator.id, authenticator)
      yield () => authenticators.delete(authenticator.id)
    }, 'principal.register()')
    return () => void dispose()
  }

  /**
   * Whether at least one authenticator is registered. Workspace ownership and
   * checkout isolation require this, not merely that the service is mounted.
   * @returns true when a caller is expected on Host requests.
   */
  hasAuthenticators(): boolean {
    return this.authenticators.size > 0
  }

  /**
   * The caller bound by the current `run` continuation.
   * @returns the bound principal, or `undefined` outside `run` / when bind found none.
   */
  current(): Principal | undefined {
    return storage.getStore()
  }

  /**
   * The bound caller, or a rejection when none is bound.
   * @param action - included in the error message.
   * @returns the bound principal.
   */
  require(action: string): Principal {
    const principal = this.current()
    if (principal === undefined) throw new PrincipalUnauthenticatedError(action)
    return principal
  }

  /**
   * Bind `principal` for the duration of `fn`. Nested `run` calls replace the
   * store for the inner continuation and restore the outer value afterwards.
   * Concurrent `run` calls do not share a store.
   * @param principal - caller to expose via {@link current}, or `undefined`.
   * @param fn - work that may read {@link current}.
   * @returns `fn`'s return value.
   */
  run<T>(principal: Principal | undefined, fn: () => T): T {
    return storage.run(principal, fn)
  }

  /**
   * Ask authenticators in registration order until one returns a principal.
   * Does not bind ALS; the HTTP carrier wraps the handler in {@link run}.
   * @param request - inbound WHATWG Request (cookies and Authorization).
   * @returns the first identified principal, or `undefined` when none matched.
   */
  async bindFromRequest(request: Request): Promise<Principal | undefined> {
    for (const authenticator of this.authenticators.values()) {
      const principal = await authenticator.identify(request)
      if (principal !== undefined) return principal
    }
    return undefined
  }

  /**
   * Collect logout side effects (typically `Set-Cookie` clearing) from every
   * authenticator. Identification is not required; clearing a missing cookie is
   * a no-op.
   * @param request - inbound request whose cookies/headers to clear.
   * @returns merged `Set-Cookie` values for the HTTP response.
   */
  async logout(request: Request): Promise<PrincipalLogout> {
    const setCookie: string[] = []
    for (const authenticator of this.authenticators.values()) {
      const result = await authenticator.logout?.(request)
      if (result?.setCookie !== undefined) setCookie.push(...result.setCookie)
    }
    return setCookie.length === 0 ? {} : { setCookie }
  }
}

export default PrincipalService
