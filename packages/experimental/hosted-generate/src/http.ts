/** HTTP routes over `ctx.webServer` for hosted generation. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { HostedGenerateError } from './error.ts'
import { GenerateSessionId } from './types.ts'
import type { GenerateArtifact, GenerateStartRequest, GenerateStatus } from './types.ts'

/** In-process generate operations the HTTP routes call. */
export interface GenerateHttpHost {
  /** Start one generation. */
  start(request: GenerateStartRequest): Promise<{ sessionId: import('./types.ts').GenerateSessionId }>
  /** Read one generation's public status. */
  status(sessionId: import('./types.ts').GenerateSessionId): GenerateStatus
  /** Read one completed generation's file map. */
  artifact(sessionId: import('./types.ts').GenerateSessionId): GenerateArtifact
}

const GENERATE_PATH = '/generate'
const SESSIONS_PREFIX = '/sessions'

/**
 * Register exact `/generate` and prefix `/sessions` routes.
 * @param webServer - listening host web server.
 * @param service - generate operations.
 * @param authToken - required bearer token; empty disables authentication.
 * @param maxPromptBytes - JSON body cap used for POST /generate.
 * @returns a disposer that removes both routes.
 */
export function mountGenerateRoutes(
  webServer: WebServer,
  service: GenerateHttpHost,
  authToken: string,
  maxPromptBytes: number,
): () => void {
  const disposeGenerate = webServer.register({
    kind: 'exact',
    path: GENERATE_PATH,
    handler: (req, res) => {
      void handleGenerate(req, res, service, authToken, maxPromptBytes)
    },
  })
  const disposeSessions = webServer.register({
    kind: 'prefix',
    path: SESSIONS_PREFIX,
    handler: (req, res) => {
      handleSessions(req, res, service, authToken)
    },
  })
  return () => {
    disposeGenerate()
    disposeSessions()
  }
}

/** Route POST /generate. */
async function handleGenerate(
  req: IncomingMessage,
  res: ServerResponse,
  service: GenerateHttpHost,
  authToken: string,
  maxPromptBytes: number,
): Promise<void> {
  try {
    assertAuthorized(req, authToken)
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: { code: 'GENERATE_INVALID_REQUEST', message: 'POST /generate is required' } })
      return
    }
    const body = await readJsonBody(req, maxPromptBytes + 4096)
    const prompt = typeof body === 'object' && body !== null && 'prompt' in body
      ? (body as GenerateStartRequest).prompt
      : undefined
    const tenantId = typeof body === 'object' && body !== null && 'tenantId' in body
      ? (body as GenerateStartRequest).tenantId
      : undefined
    if (typeof prompt !== 'string') {
      throw new HostedGenerateError('GENERATE_INVALID_REQUEST', 'prompt must be a string')
    }
    if (tenantId !== undefined && typeof tenantId !== 'string') {
      throw new HostedGenerateError('GENERATE_INVALID_REQUEST', 'tenantId must be a string when provided')
    }
    const started = await service.start({
      prompt,
      ...typeof tenantId === 'string' ? { tenantId } : {},
    })
    sendJson(res, 202, started)
  } catch (error: unknown) {
    writeError(res, error)
  }
}

/** Route GET /sessions/:id and GET /sessions/:id/artifact. */
function handleSessions(
  req: IncomingMessage,
  res: ServerResponse,
  service: GenerateHttpHost,
  authToken: string,
): void {
  try {
    assertAuthorized(req, authToken)
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: { code: 'GENERATE_INVALID_REQUEST', message: 'GET is required' } })
      return
    }
    const path = pathname(req)
    const rest = path.slice(SESSIONS_PREFIX.length)
    const match = /^\/([^/]+)(\/artifact)?$/.exec(rest)
    if (match === null || match[1] === undefined) {
      throw new HostedGenerateError('GENERATE_NOT_FOUND', 'generation session path is invalid')
    }
    const sessionId = GenerateSessionId(decodeURIComponent(match[1]))
    if (match[2] === '/artifact') {
      sendJson(res, 200, service.artifact(sessionId))
      return
    }
    sendJson(res, 200, service.status(sessionId))
  } catch (error: unknown) {
    writeError(res, error)
  }
}

/**
 * Require the configured bearer token when one is set.
 * @param req - incoming request.
 * @param authToken - configured shared secret; empty skips the check.
 */
function assertAuthorized(req: IncomingMessage, authToken: string): void {
  if (authToken === '') return
  const header = req.headers.authorization
  if (header !== `Bearer ${authToken}`) {
    throw new HostedGenerateError('GENERATE_UNAUTHORIZED', 'bearer token is missing or invalid')
  }
}

/**
 * Read a JSON object from the request body.
 * @param req - incoming request.
 * @param maxBytes - inclusive body cap.
 * @returns the parsed value.
 */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk)
    total += buf.byteLength
    if (total > maxBytes) {
      throw new HostedGenerateError('GENERATE_INVALID_REQUEST', 'request body too large')
    }
    chunks.push(buf)
  }
  if (total === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HostedGenerateError('GENERATE_INVALID_REQUEST', 'request body is not JSON')
  }
}

/** Map a thrown value onto an HTTP error envelope. */
function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof HostedGenerateError) {
    sendJson(res, statusFor(error.code), { error: { code: error.code, message: error.message } })
    return
  }
  sendJson(res, 500, {
    error: {
      code: 'GENERATE_FAILED',
      message: error instanceof Error ? error.message : String(error),
    },
  })
}

/** HTTP status for a generate error code. */
function statusFor(code: HostedGenerateError['code']): number {
  switch (code) {
    case 'GENERATE_UNAUTHORIZED': return 401
    case 'GENERATE_NOT_FOUND': return 404
    case 'GENERATE_BUSY': return 409
    case 'GENERATE_FAILED': return 500
    default: return 400
  }
}

/** Write a JSON response. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
  })
  res.end(json)
}

/** Pathname without query string. */
function pathname(req: IncomingMessage): string {
  /* v8 ignore next -- the webserver always supplies IncomingMessage.url. */
  const url = req.url ?? '/'
  const cut = url.indexOf('?')
  return cut === -1 ? url : url.slice(0, cut)
}
