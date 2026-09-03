/** Structured failures for hosted generation. */

import type { HostedGenerateErrorCode } from './types.ts'

/**
 * Failures the generate service returns to in-process callers and HTTP clients.
 */
export class HostedGenerateError extends Error {
  /**
   * @param code - stable machine-readable failure class.
   * @param message - human-readable detail without secrets or workspace paths.
   */
  constructor(
    readonly code: HostedGenerateErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'HostedGenerateError'
  }
}
