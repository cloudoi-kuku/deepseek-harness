/** Host Auth Remote: who is bound to this request, and logout. */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-principal'
import type { AuthMeValue } from './types.ts'

/**
 * Optional principal projection. Unauthenticated `me` is a success with
 * `authenticated: false`, not an error. Default `dsh web` does not mount
 * `ctx.principal`.
 */
export class AuthController extends TypertRemoteService {
  static inject = ['typert']

  /**
   * @param ctx - Host context; `principal` is optional.
   */
  constructor(ctx: Context) {
    super(ctx, 'authController', { namespace: 'auth' })
  }

  /**
   * The principal bound to this request.
   * @returns anonymous or the bound tenant+user.
   */
  @Remote('me')
  me(): AuthMeValue {
    const principal = this.ctx.get('principal')?.current()
    if (principal === undefined) return { authenticated: false }
    return {
      authenticated: true,
      tenantId: principal.tenantId,
      userId: principal.userId,
      ...principal.product === undefined ? {} : { product: principal.product },
    }
  }

  /**
   * Confirm logout. The HTTP carrier clears authenticator cookies on this
   * endpoint; this Remote does not see the Request.
   * @returns logout confirmation.
   */
  @Remote('logout')
  logout(): { loggedOut: true } {
    return { loggedOut: true }
  }
}
