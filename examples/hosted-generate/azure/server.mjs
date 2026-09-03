/**
 * Scale-to-zero Azure stand-in for the hosted-generate HTTP contract.
 * Same routes as the local dsh POC; the first generation returns a fixed
 * static file map so Envon Container Apps can be proven without model spend.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.PORT ?? 3081)
const TOKEN = process.env.GENERATE_TOKEN ?? ''
const INDEX_HTML = '<h1>POC</h1>'

/** @typedef {{ sessionId: string, status: string, tenantId?: string, fileCount?: number, byteCount?: number, stepCount?: number, error?: { code: string, message: string } }} Status */
/** @typedef {{ status: Status, artifact?: { sessionId: string, files: Record<string, string> } }} Record */

/** @type {Map<string, Record>} */
const records = new Map()

const server = createServer((req, res) => {
  void handle(req, res)
})

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function handle(req, res) {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true })
      return
    }
    assertAuthorized(req)
    if (req.method === 'POST' && url.pathname === '/generate') {
      const body = await readJson(req)
      if (typeof body.prompt !== 'string' || body.prompt.trim() === '') {
        send(res, 400, { error: { code: 'GENERATE_INVALID_REQUEST', message: 'prompt must be a non-empty string' } })
        return
      }
      if (runningCount() >= 1) {
        send(res, 409, { error: { code: 'GENERATE_BUSY', message: 'a generation is already running' } })
        return
      }
      const sessionId = `generate-${randomUUID()}`
      /** @type {Status} */
      const status = { sessionId, status: 'running', stepCount: 0 }
      if (typeof body.tenantId === 'string') status.tenantId = body.tenantId
      records.set(sessionId, { status })
      prune()
      setTimeout(() => {
        const record = records.get(sessionId)
        if (record === undefined) return
        record.status = {
          ...record.status,
          status: 'completed',
          stepCount: 2,
          fileCount: 1,
          byteCount: Buffer.byteLength(INDEX_HTML),
        }
        record.artifact = { sessionId, files: { 'index.html': INDEX_HTML } }
      }, 150)
      send(res, 202, { sessionId })
      return
    }
    const session = /^\/sessions\/([^/]+)(\/artifact)?$/.exec(url.pathname)
    if (req.method === 'GET' && session !== null && session[1] !== undefined) {
      const record = records.get(decodeURIComponent(session[1]))
      if (record === undefined) {
        send(res, 404, { error: { code: 'GENERATE_NOT_FOUND', message: 'generation session does not exist' } })
        return
      }
      if (session[2] === '/artifact') {
        if (record.status.status !== 'completed' || record.artifact === undefined) {
          send(res, 404, { error: { code: 'GENERATE_NOT_FOUND', message: 'artifact is not available' } })
          return
        }
        send(res, 200, record.artifact)
        return
      }
      send(res, 200, record.status)
      return
    }
    send(res, 404, { error: { code: 'GENERATE_NOT_FOUND', message: 'path is not a generate route' } })
  } catch (error) {
    if (error instanceof AuthError) {
      send(res, 401, { error: { code: 'GENERATE_UNAUTHORIZED', message: error.message } })
      return
    }
    send(res, 400, {
      error: {
        code: 'GENERATE_INVALID_REQUEST',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function runningCount() {
  let n = 0
  for (const record of records.values()) if (record.status.status === 'running') n += 1
  return n
}

function prune() {
  const terminal = [...records.entries()].filter(([, record]) => record.status.status !== 'running')
  const overflow = terminal.length - 8
  if (overflow <= 0) return
  for (const [id] of terminal.slice(0, overflow)) records.delete(id)
}

class AuthError extends Error {}

/** @param {IncomingMessage} req */
function assertAuthorized(req) {
  if (TOKEN === '') return
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    throw new AuthError('bearer token is missing or invalid')
  }
}

/** @param {IncomingMessage} req */
async function readJson(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk)
    total += buf.byteLength
    if (total > 16_384) throw new Error('request body too large')
    chunks.push(buf)
  }
  if (total === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * @param {ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
  })
  res.end(json)
}

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`hosted-generate-poc: http://0.0.0.0:${String(PORT)}/generate\n`)
})
