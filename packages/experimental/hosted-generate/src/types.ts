/** Public identities, requests, and status records for hosted generation. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one hosted generation run. */
export type GenerateSessionId = Branded<'GenerateSessionId'>

/**
 * Brand a generation-session identity.
 * @param id - opaque session identity.
 * @returns the same string branded as a generation session id.
 */
export function GenerateSessionId(id: string): GenerateSessionId {
  return id as GenerateSessionId
}

/** Stable failure codes returned by {@link HostedGenerateError}. */
export type HostedGenerateErrorCode =
  | 'GENERATE_BUSY'
  | 'GENERATE_INVALID_REQUEST'
  | 'GENERATE_NOT_FOUND'
  | 'GENERATE_UNAUTHORIZED'
  | 'GENERATE_TIMEOUT'
  | 'GENERATE_FAILED'
  | 'GENERATE_TOO_LARGE'

/** Request accepted by {@link HostedGenerateService.start}. */
export interface GenerateStartRequest {
  /** User-authored brief for the site or app. */
  prompt: string
  /** Optional product tenant correlation id; isolation is per process, not this field. */
  tenantId?: string
}

/** Terminal or in-flight status of one generation. */
export type GenerateStatusKind = 'running' | 'completed' | 'failed' | 'cancelled'

/** Public status of one generation session. */
export interface GenerateStatus {
  /** Generation identity returned by start. */
  sessionId: GenerateSessionId
  /** Optional tenant correlation echoed from the start request. */
  tenantId?: string
  /** Lifecycle of this generation. */
  status: GenerateStatusKind
  /** Structured failure when status is `failed` or `cancelled`. */
  error?: { code: HostedGenerateErrorCode; message: string }
  /** Count of UTF-8 files in the artifact when collection succeeded. */
  fileCount?: number
  /** Total UTF-8 bytes in the artifact when collection succeeded. */
  byteCount?: number
  /** Durable `step/end` count observed before settlement. */
  stepCount?: number
}

/** Collected workspace files keyed by posix-relative path. */
export interface GenerateArtifact {
  /** Generation identity. */
  sessionId: GenerateSessionId
  /** UTF-8 file map; paths are relative to the disposable workspace. */
  files: Record<string, string>
}

/** Deployment config for the hosted-generate service. */
export interface Config {
  /** Provider route used for every created Agent. */
  provider: string
  /** Model id used for every created Agent. */
  model: string
  /** Maximum generations running at once. */
  maxConcurrentSessions?: number
  /** Wall-clock bound for one Agent run. */
  sessionTimeoutMs?: number
  /** Durable step bound; crossing it cancels the Agent. */
  maxSteps?: number
  /** Total UTF-8 artifact budget. */
  maxArtifactBytes?: number
  /** Maximum files retained in one artifact. */
  maxFiles?: number
  /** Maximum UTF-8 bytes of one retained file. */
  maxFileBytes?: number
  /** Maximum UTF-8 bytes of the start-request prompt. */
  maxPromptBytes?: number
  /** Completed records retained for later GET after workspace wipe. */
  maxRetainedSessions?: number
  /** Parent directory for disposable per-session workspaces. */
  workspaceParent?: string
  /** Model-visible generation instructions prepended to the user prompt. */
  taskGuidance?: string
  /** Optional shared bearer token; empty disables HTTP authentication. */
  authToken?: string
  /** When true, print the loopback generate URL after the web server listens. */
  printListen?: boolean
}
