/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-experimental-hosted-generate`.
 * @module @deepseek-ai/dsh-experimental-hosted-generate/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-hosted-generate'

/** Cordis companion plugin name. */
export const name = 'hosted-generate-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: generation occupancy and workspace wipe live in a
 * process-local map with no independent event stream a companion can compare
 * without starting a generation as a side effect. Occupancy and wipe are
 * asserted by the service tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
