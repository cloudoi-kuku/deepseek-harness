/**
 * Hosted multi-tenant policy (`ctx.hostedLimits`): kill switch, per-user
 * workspace and live-session caps, git-op rate limit, and the checkout root
 * used when a principal is bound. Unmounted compositions have no quotas.
 * @module @deepseek-ai/dsh-hosted-limits
 */

import { isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/cordis' {
  interface Context {
    hostedLimits: HostedLimits
  }
}

/** Tenant/user pair used as the quota key. */
export interface LimitOwner {
  readonly tenantId: string
  readonly userId: string
}

/** Quota / kill-switch / rate-limit rejection. */
export class HostedLimitsError extends Error {
  /**
   * @param code - stable machine code mapped by the Host RPC layer.
   * @param message - human-readable rejection.
   * @param details - kind/limit for quota and rate-limit codes.
   */
  constructor(
    readonly code: 'kill-switch' | 'quota-exceeded' | 'rate-limited' | 'checkout-root-missing',
    message: string,
    readonly details: { kind?: string; limit?: number } = {},
  ) {
    super(message)
    this.name = 'HostedLimitsError'
  }
}

/** Plugin config: all numeric caps treat `0` as unlimited. */
export interface Config {
  /** When true, mutating workspace/session/git RPCs fail with `kill-switch`. */
  killSwitch?: boolean
  /** Absolute directory under which per-tenant/user git checkouts are placed. */
  checkoutRoot?: string
  /** Maximum durable workspaces per tenant+user; `0` is unlimited. */
  maxWorkspacesPerUser?: number
  /** Maximum live sessions on workspaces owned by one tenant+user; `0` is unlimited. */
  maxConcurrentSessionsPerUser?: number
  /** Maximum git status/commit/push/pull/branch calls per user per minute; `0` is unlimited. */
  maxGitOpsPerMinute?: number
}

export const Config: z<Config> = z.object({
  killSwitch: z.boolean().default(false),
  checkoutRoot: z.string(),
  maxWorkspacesPerUser: z.number().default(0),
  maxConcurrentSessionsPerUser: z.number().default(0),
  maxGitOpsPerMinute: z.number().default(0),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = {
  killSwitch: boolean
  checkoutRoot?: string
  maxWorkspacesPerUser: number
  maxConcurrentSessionsPerUser: number
  maxGitOpsPerMinute: number
}

/**
 * Hosted abuse and isolation policy. Default web-app does not mount this
 * service; hosted patches do.
 */
export class HostedLimits extends Service {
  static Config = Config

  private readonly gitOps = new Map<string, number[]>()
  private readonly now: () => number

  /**
   * @param ctx - Cordis context this service is installed on.
   * @param config - quotas and checkout root; schemastery fills defaults.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'hostedLimits')
    const resolved = config as ResolvedConfig
    if (!Number.isFinite(resolved.maxWorkspacesPerUser) || resolved.maxWorkspacesPerUser < 0) {
      throw new Error('hosted-limits: maxWorkspacesPerUser must be a finite number >= 0')
    }
    if (!Number.isFinite(resolved.maxConcurrentSessionsPerUser) || resolved.maxConcurrentSessionsPerUser < 0) {
      throw new Error('hosted-limits: maxConcurrentSessionsPerUser must be a finite number >= 0')
    }
    if (!Number.isFinite(resolved.maxGitOpsPerMinute) || resolved.maxGitOpsPerMinute < 0) {
      throw new Error('hosted-limits: maxGitOpsPerMinute must be a finite number >= 0')
    }
    if (resolved.checkoutRoot !== undefined && resolved.checkoutRoot !== '' && !isAbsolute(resolved.checkoutRoot)) {
      throw new Error(`hosted-limits: checkoutRoot must be an absolute directory, got '${resolved.checkoutRoot}'`)
    }
    this.resolved = resolved
    this.now = () => Date.now()
  }

  private readonly resolved: ResolvedConfig

  /**
   * Absolute git checkout parent root, when configured.
   * @returns the configured root, or `undefined`.
   */
  get checkoutRoot(): string | undefined {
    const root = this.resolved.checkoutRoot
    return root === undefined || root === '' ? undefined : root
  }

  /**
   * Reject when the deployment kill switch is on.
   */
  assertNotKilled(): void {
    if (this.resolved.killSwitch) {
      throw new HostedLimitsError('kill-switch', 'hosted deployment kill switch is on')
    }
  }

  /**
   * Reject a new workspace when the per-user cap is already reached.
   * @param owner - tenant+user the new record would belong to.
   * @param existingCount - workspaces already owned by that pair.
   */
  assertWorkspaceCreate(owner: LimitOwner, existingCount: number): void {
    this.assertNotKilled()
    const limit = this.resolved.maxWorkspacesPerUser
    if (limit > 0 && existingCount >= limit) {
      throw new HostedLimitsError(
        'quota-exceeded',
        `user ${owner.tenantId}/${owner.userId} already has ${String(existingCount)} workspaces (limit ${String(limit)})`,
        { kind: 'workspace', limit },
      )
    }
  }

  /**
   * Reject a new live session when the per-user cap is already reached.
   * @param owner - tenant+user owning the workspace.
   * @param liveCount - live sessions already attached to that owner's workspaces.
   */
  assertSessionCreate(owner: LimitOwner, liveCount: number): void {
    this.assertNotKilled()
    const limit = this.resolved.maxConcurrentSessionsPerUser
    if (limit > 0 && liveCount >= limit) {
      throw new HostedLimitsError(
        'quota-exceeded',
        `user ${owner.tenantId}/${owner.userId} already has ${String(liveCount)} live sessions (limit ${String(limit)})`,
        { kind: 'session', limit },
      )
    }
  }

  /**
   * Reject a git RPC when the per-minute cap is already reached. Process-local.
   * @param owner - tenant+user performing the git operation.
   */
  assertGitOp(owner: LimitOwner): void {
    this.assertNotKilled()
    const limit = this.resolved.maxGitOpsPerMinute
    if (limit <= 0) return
    const key = `${owner.tenantId}/${owner.userId}`
    const now = this.now()
    const windowStart = now - 60_000
    const stamps = (this.gitOps.get(key) ?? []).filter(time => time > windowStart)
    if (stamps.length >= limit) {
      throw new HostedLimitsError(
        'rate-limited',
        `user ${key} exceeded ${String(limit)} git operations per minute`,
        { kind: 'git-op', limit },
      )
    }
    stamps.push(now)
    this.gitOps.set(key, stamps)
  }

  /**
   * The checkout root required for isolated git checkouts, or a loud failure.
   * @returns the absolute checkout root.
   */
  requireCheckoutRoot(): string {
    const root = this.checkoutRoot
    if (root === undefined) {
      throw new HostedLimitsError(
        'checkout-root-missing',
        'hosted-limits.checkoutRoot is required when principal authenticators are mounted',
      )
    }
    return root
  }
}

export default HostedLimits
