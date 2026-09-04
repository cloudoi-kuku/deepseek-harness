/**
 * Per-principal git checkout path helpers. Tokens never appear here.
 * @module @deepseek-ai/dsh-workspace/src/isolation
 */

import { join } from 'node:path'
import type { WorkspaceOwner } from './types.ts'

/**
 * Reject path-separator and `.` / `..` segments so tenant/user ids cannot
 * escape `checkoutRoot`.
 * @param value - tenantId or userId.
 * @returns the same string when it is a single path segment.
 */
export function principalCheckoutSegment(value: string): string {
  if (value === '' || value === '.' || value === '..' || /[\\/]/.test(value)) {
    throw new Error(`cannot use '${value}' as a checkout path segment`)
  }
  return value
}

/**
 * Isolated git checkout parent: `checkoutRoot/<tenantId>/<userId>`.
 * @param checkoutRoot - absolute hosted checkout root.
 * @param owner - authenticated tenant+user.
 * @returns the absolute parent passed to the git workspace-source provider.
 */
export function isolatedCheckoutParent(checkoutRoot: string, owner: WorkspaceOwner): string {
  return join(
    checkoutRoot,
    principalCheckoutSegment(owner.tenantId),
    principalCheckoutSegment(owner.userId),
  )
}

/**
 * Whether a stored owner matches a caller.
 * @param left - workspace owner, possibly omitted on OSS records.
 * @param right - authenticated tenant+user.
 * @returns true when both ids match.
 */
export function sameWorkspaceOwner(
  left: WorkspaceOwner | undefined,
  right: { tenantId: string; userId: string },
): boolean {
  return left !== undefined && left.tenantId === right.tenantId && left.userId === right.userId
}
