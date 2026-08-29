/**
 * Loopback generate HTTP for CoreNet. Same routes as hosted-generate:
 * POST /generate, GET /sessions/:id, GET /sessions/:id/artifact.
 * Runs `dsh --profile headless` with grok + generate patches in a temp dir,
 * then returns a UTF-8 file map. Binds 127.0.0.1; the public proxy authenticates.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { launchTokenFromRequest } from './launch-token.mjs'

const PORT = Number(process.env.GENERATE_PORT ?? 3081)
const TIMEOUT_MS = Number(process.env.GENERATE_TIMEOUT_MS ?? 180_000)
const MAX_FILES = Number(process.env.GENERATE_MAX_FILES ?? 32)
const MAX_FILE_BYTES = Number(process.env.GENERATE_MAX_FILE_BYTES ?? 65_536)
const MAX_ARTIFACT_BYTES = Number(process.env.GENERATE_MAX_ARTIFACT_BYTES ?? 524_288)
const SKIP_DIRECTORY_NAMES = new Set(['node_modules', '.git', '.sessions'])
const CORENET_FROM_HARNESS_URL = (process.env.CORENET_FROM_HARNESS_URL ?? '').replace(/\/$/, '')
const GUIDANCE = [
  'Generate a static website or small app in this workspace.',
  'Write UTF-8 files under the workspace root.',
  'Do not deploy, do not use network services, and do not read files outside the workspace.',
  'Stop when the files are ready.',
].join(' ')

/** @type {Map<string, { status: object, artifact?: { sessionId: string, files: Record<string, string> }, workspace?: string }>} */
const records = new Map()

const server = createServer((req, res) => {
  void handle(req, res)
})

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handle(req, res) {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true })
      return
    }
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
      /** @type {{ sessionId: string, status: string, tenantId?: string, stepCount?: number }} */
      const status = { sessionId, status: 'running', stepCount: 0 }
      if (typeof body.tenantId === 'string') status.tenantId = body.tenantId
      records.set(sessionId, { status, launchToken: launchTokenFromRequest(req) })
      prune()
      void runGeneration(sessionId, body.prompt.trim())
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
    send(res, 400, {
      error: {
        code: 'GENERATE_INVALID_REQUEST',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

/**
 * @param {string} sessionId
 * @param {string} prompt
 */
async function runGeneration(sessionId, prompt) {
  const record = records.get(sessionId)
  if (record === undefined) return
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-generate-'))
  record.workspace = workspace
  const home = join(workspace, '.home')
  try {
    await mkdir(join(home, '.dsh'), { recursive: true })
    const exitCode = await runHeadless(workspace, home, prompt)
    const files = await collectArtifact(workspace)
    if (Object.keys(files).length === 0) {
      record.status = {
        ...record.status,
        status: 'failed',
        error: {
          code: 'GENERATE_FAILED',
          message: exitCode === 0 ? 'generation produced no UTF-8 files' : `dsh headless exited ${String(exitCode)}`,
        },
      }
      return
    }
    let byteCount = 0
    for (const content of Object.values(files)) byteCount += Buffer.byteLength(content)
    record.status = {
      ...record.status,
      status: 'completed',
      fileCount: Object.keys(files).length,
      byteCount,
      stepCount: record.status.stepCount ?? 0,
    }
    record.artifact = { sessionId, files }
    const published = await publishToCorenet(record.launchToken, prompt, files)
    if (published) {
      record.status = { ...record.status, ...published }
    }
  } catch (error) {
    record.status = {
      ...record.status,
      status: 'failed',
      error: {
        code: 'GENERATE_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
    record.workspace = undefined
  }
}

/**
 * @param {string} cwd
 * @param {string} home
 * @param {string} prompt
 */
function runHeadless(cwd, home, prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      '--profile', 'headless',
      '--patch', '/app/grok.patch.yml',
      '--patch', '/app/generate.patch.yml',
      `${GUIDANCE}\n\nUser request:\n${prompt}`,
    ]
    const child = spawn('dsh', args, {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        DSH_HOME: join(home, '.dsh'),
        LLM_API_KEY: process.env.LLM_API_KEY ?? 'bridge',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
      if (stderr.length > 8192) stderr = stderr.slice(-8192)
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
    }, TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      if (signal === 'SIGTERM') {
        reject(new Error('generation timed out'))
        return
      }
      if (code !== 0 && code !== null) {
        process.stderr.write(`generate-server: dsh exit ${String(code)} ${stderr.slice(-500)}\n`)
      }
      resolve(code ?? 1)
    })
  })
}

/**
 * @param {string | undefined} launchToken
 * @param {string} prompt
 * @param {Record<string, string>} files
 */
async function publishToCorenet(launchToken, prompt, files) {
  if (CORENET_FROM_HARNESS_URL === '' || !launchToken) return undefined
  try {
    const response = await fetch(`${CORENET_FROM_HARNESS_URL}/api/ai-build/from-harness/launch`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${launchToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt, files, modelId: 'grok', scaffold: 'static-react-vite' }),
      signal: AbortSignal.timeout(120_000),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      process.stderr.write(`generate-server: CoreNet publish ${String(response.status)}\n`)
      return { publishError: typeof body.detail === 'string' ? body.detail : 'CoreNet publish failed' }
    }
    return {
      repositoryUrl: body.repositoryUrl,
      publicUrl: body.publicUrl,
      siteId: body.siteId,
    }
  } catch (error) {
    process.stderr.write(`generate-server: CoreNet publish ${error instanceof Error ? error.message : String(error)}\n`)
    return { publishError: 'CoreNet publish failed' }
  }
}

/** @param {string} workspaceRoot */
async function collectArtifact(workspaceRoot) {
  /** @type {Record<string, string>} */
  const files = {}
  let totalBytes = 0
  const entries = await readdir(workspaceRoot, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const relativeDir = entry.parentPath === workspaceRoot ? '' : relative(workspaceRoot, entry.parentPath)
    if (relativeDir.startsWith('..') || isAbsolute(relativeDir)) continue
    const parts = relativeDir === '' ? [] : relativeDir.split(sep)
    if (parts.some((part) => part.startsWith('.') || SKIP_DIRECTORY_NAMES.has(part))) continue
    if (entry.name.startsWith('.')) continue
    const relativePath = [...parts, entry.name].join('/')
    if (relativePath === '' || relativePath.includes('\0')) continue
    const bytes = await readFile(`${entry.parentPath}${sep}${entry.name}`)
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`file ${relativePath} exceeds maxFileBytes`)
    let text
    try {
      text = new TextDecoder('utf8', { fatal: true }).decode(bytes)
    } catch {
      continue
    }
    const size = Buffer.byteLength(text)
    if (Object.keys(files).length >= MAX_FILES) throw new Error('artifact exceeds maxFiles')
    if (totalBytes + size > MAX_ARTIFACT_BYTES) throw new Error('artifact exceeds maxArtifactBytes')
    files[relativePath] = text
    totalBytes += size
  }
  return files
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

/** @param {import('node:http').IncomingMessage} req */
async function readJson(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk)
    total += buf.byteLength
    if (total > 32_768) throw new Error('request body too large')
    chunks.push(buf)
  }
  if (total === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * @param {import('node:http').ServerResponse} res
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

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`generate-server: http://127.0.0.1:${String(PORT)}/generate timeout=${String(TIMEOUT_MS)}ms\n`)
})
