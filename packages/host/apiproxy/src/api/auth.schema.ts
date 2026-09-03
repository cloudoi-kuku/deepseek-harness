/**
 * auth domain zod schemas (names derived from map keys).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { AuthMeView } from './auth.ts'

/** auth.me request payload (empty object literal). */
export const authMeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'auth.me'>>>

/** auth.me response value. */
export const authMeValueSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false) }),
  z.object({
    authenticated: z.literal(true),
    tenantId: z.string(),
    userId: z.string(),
    product: z.string().optional(),
  }),
]) satisfies z.ZodType<Wire<AuthMeView>>

/** auth.logout request payload (empty object literal). */
export const authLogoutRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'auth.logout'>>>

/** auth.logout response value. */
export const authLogoutValueSchema = z.object({
  loggedOut: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'auth.logout'>>>
