/**
 * Product-auth Host RPC: who is bound to this request, and logout.
 * Unauthenticated `me` is a success with `authenticated: false`, not an error.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** `auth.me` value: anonymous or the bound tenant+user. Never includes a token. */
export type AuthMeView =
  | { authenticated: false }
  | { authenticated: true; tenantId: string; userId: string; product?: string | undefined }

/** Auth-domain unary methods (the map keys auth.* of RpcMethodMap). */
export interface AuthApi {
  /**
   * The principal bound to this request. With no principal service or no
   * matching authenticator this is `{ authenticated: false }`.
   */
  me(request: RpcRequest<{}>): Promise<RpcResponse<AuthMeView>>

  /**
   * Clear authenticator cookies (`Set-Cookie` on the HTTP response). Success
   * even when no cookie was present.
   */
  logout(request: RpcRequest<{}>): Promise<RpcResponse<{ loggedOut: true }>>
}
