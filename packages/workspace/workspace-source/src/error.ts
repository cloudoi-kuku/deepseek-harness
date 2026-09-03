/**
 * Classified failures of the workspace-source seam.
 * @module @deepseek-ai/dsh-workspace-source/src/error
 */

/** Stable failure classes for resolve, prepare, and git operations. */
export type WorkspaceSourceErrorCode =
  | 'WORKSPACE_SOURCE_UNKNOWN_KIND'
  | 'WORKSPACE_SOURCE_DUPLICATE_KIND'
  | 'WORKSPACE_SOURCE_INVALID_REQUEST'
  | 'WORKSPACE_SOURCE_PREPARE_FAILED'
  | 'WORKSPACE_SOURCE_NOT_GIT'
  | 'WORKSPACE_SOURCE_GIT_FAILED'

/**
 * A workspace-source operation could not complete. `code` is the stable
 * discriminant; the message names the subject and the violated rule.
 */
export class WorkspaceSourceError extends Error {
  override readonly name = 'WorkspaceSourceError'

  /**
   * @param code - stable failure class.
   * @param message - diagnostic retained as the Error message.
   * @param options - optional original failure.
   */
  constructor(
    readonly code: WorkspaceSourceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
