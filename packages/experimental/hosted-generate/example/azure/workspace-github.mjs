/**
 * Materialize a CoreNet GitHub workspace into the dsh cwd and register it with dsh web.
 * Envon fetches GET /api/ai-build/from-harness/workspace with the launch token as Bearer.
 * The GitHub token is stored in a git credential file, never in the launch query string.
 * `workspace.create` on `/workspace` is what skips the dsh web directory picker.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CORENET = (process.env.CORENET_FROM_HARNESS_URL ?? '').replace(/\/$/, '')
export const WORKSPACE_DIR = process.env.HARNESS_WORKSPACE_DIR ?? '/workspace'
const CREDENTIALS_FILE = process.env.HARNESS_GIT_CREDENTIALS ?? join(process.env.HOME ?? homedir(), '.git-credentials')
const PUSH_INTERVAL_MS = Number(process.env.HARNESS_GIT_PUSH_INTERVAL_MS ?? 15_000)

let mountPromise = null
let pushTimer = null

function dshOrigin() {
  return `http://127.0.0.1:${process.env.DSH_PORT ?? 3080}`
}

/**
 * @param {unknown} body
 * @returns {{ kind: 'github', owner: string, name: string, token: string, cloneUrl: string, defaultBranch: string } | null}
 */
export function parseWorkspaceGrant(body) {
  if (body === null || typeof body !== 'object') return null
  const record = /** @type {Record<string, unknown>} */ (body)
  if (record.kind !== 'github') return null
  const owner = String(record.owner ?? '').trim()
  const name = String(record.name ?? '').trim()
  const token = String(record.token ?? '').trim()
  const cloneUrl = String(record.cloneUrl ?? '').trim()
  const defaultBranch = String(record.defaultBranch ?? 'main').trim() || 'main'
  const brief = typeof record.brief === 'string' ? record.brief.trim() : ''
  if (owner === '' || name === '' || token === '' || cloneUrl === '') return null
  return { kind: 'github', owner, name, token, cloneUrl, defaultBranch, brief }
}

/**
 * @param {string} owner
 * @param {string} name
 */
export function githubHttpsOrigin(owner, name) {
  return `https://github.com/${owner}/${name}.git`
}

/**
 * @param {string} launchToken
 * @param {{ fetchImpl?: typeof fetch, origin?: string }} [opts]
 */
export async function fetchWorkspaceGrant(launchToken, opts = {}) {
  const origin = (opts.origin ?? CORENET).replace(/\/$/, '')
  if (origin === '') {
    throw new Error('CORENET_FROM_HARNESS_URL is not set')
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  const response = await fetchImpl(`${origin}/api/ai-build/from-harness/workspace`, {
    headers: { authorization: `Bearer ${launchToken}` },
  })
  const raw = await response.text()
  let body = null
  try {
    body = raw === '' ? null : JSON.parse(raw)
  } catch {
    body = null
  }
  if (response.status === 401) {
    throw new Error('launch token was rejected by CoreNet')
  }
  const problem = problemDetail(body) || (!body && raw !== '' && raw.length < 300 ? raw : '')
  if (response.status === 400) {
    throw new Error(problem || 'GitHub must be connected on CoreNet before opening Envon Harness')
  }
  if (!response.ok) {
    throw new Error(problem || `workspace grant failed (${String(response.status)})`)
  }
  const grant = parseWorkspaceGrant(body)
  if (grant === null) {
    throw new Error('workspace grant is missing owner, name, token, or cloneUrl')
  }
  return grant
}

/** @param {unknown} body */
function problemDetail(body) {
  if (body === null || typeof body !== 'object') return ''
  const record = /** @type {Record<string, unknown>} */ (body)
  const detail = typeof record.detail === 'string' ? record.detail.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  return detail || title
}

/**
 * Clone or update the GitHub working tree, then start a periodic `git push`.
 * Concurrent calls share one in-flight mount; a failure clears that so a later request can retry.
 * @param {string} launchToken
 * @returns {Promise<{ kind: 'github', owner: string, name: string, token: string, cloneUrl: string, defaultBranch: string, brief: string }>}
 */
export function ensureGithubWorkspace(launchToken) {
  if (mountPromise === null) {
    mountPromise = mount(launchToken).catch((error) => {
      mountPromise = null
      throw error
    })
  }
  return mountPromise
}

/**
 * Call one Host unary Remote over loopback HTTP.
 * Typert endpoints are `<namespace>/<method>` (`workspace/create`).
 * @param {string} method - Typert endpoint, for example `workspace/create`.
 * @param {Record<string, unknown>} payload - the method's request object (the envelope `payload` slot).
 * @param {{ origin?: string, fetchImpl?: typeof fetch, rpcId?: string }} [opts]
 * @returns {Promise<unknown>}
 */
export async function dshRpc(method, payload, opts = {}) {
  const origin = (opts.origin ?? dshOrigin()).replace(/\/$/, '')
  const fetchImpl = opts.fetchImpl ?? fetch
  const rpcId = opts.rpcId ?? `envon-${Date.now().toString(36)}`
  const response = await fetchImpl(`${origin}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method,
      payload,
    }),
  })
  const raw = await response.text()
  let body = null
  try {
    body = raw === '' ? null : JSON.parse(raw)
  } catch {
    body = null
  }
  if (!response.ok) {
    const error = new Error(`dsh ${method} HTTP ${String(response.status)}`)
    error.status = response.status
    throw error
  }
  if (body === null || typeof body !== 'object' || /** @type {{ type?: unknown }} */ (body).type !== 'server-response') {
    throw new Error(`dsh ${method} returned a non-RPC body`)
  }
  const result = /** @type {{ result?: { ok?: boolean, value?: unknown, error?: { code?: string, message?: string } } }} */ (body).result
  if (result?.ok !== true) {
    const error = new Error(result?.error?.message ?? `dsh ${method} rejected`)
    error.code = result?.error?.code
    throw error
  }
  return result.value
}

/**
 * Register `/workspace` with dsh web so the composer is live (no directory picker).
 * Create is retried until dsh accepts it; rename to `title` is best-effort.
 * @param {{ path?: string, title?: string, origin?: string, fetchImpl?: typeof fetch, attempts?: number, delayMs?: number, sleep?: (ms: number) => Promise<void>, rpc?: typeof dshRpc }} [opts]
 * @returns {Promise<{ workspaceId: string, path: string, title: string }>}
 */
export async function adoptDshWorkspace(opts = {}) {
  const path = opts.path ?? WORKSPACE_DIR
  const title = opts.title ?? ''
  const attempts = opts.attempts ?? 30
  const delayMs = opts.delayMs ?? 2000
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms) }))
  const rpc = opts.rpc ?? dshRpc
  const rpcOpts = { origin: opts.origin, fetchImpl: opts.fetchImpl }

  let lastError = 'dsh web did not accept workspace/create'
  for (let i = 0; i < attempts; i += 1) {
    try {
      const value = await rpc('workspace/create', { path }, rpcOpts)
      const workspace = value !== null && typeof value === 'object'
        ? /** @type {{ workspace?: { workspaceId?: string, path?: string, title?: string } }} */ (value).workspace
        : undefined
      if (workspace === undefined || typeof workspace.workspaceId !== 'string') {
        throw new Error('dsh workspace/create returned no workspace')
      }
      if (title !== '' && workspace.title !== title) {
        try {
          await rpc('workspace/rename', { workspaceId: workspace.workspaceId, title }, rpcOpts)
        } catch {
          // Display title only; create already registered the GitHub cwd.
        }
      }
      return { workspaceId: workspace.workspaceId, path: workspace.path ?? path, title: workspace.title ?? title }
    } catch (error) {
      const rpcCode = error !== null && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined
      const httpStatus = error !== null && typeof error === 'object' && 'status' in error
        ? error.status
        : undefined
      if (rpcCode !== undefined && httpStatus === undefined) {
        throw error
      }
      lastError = error instanceof Error ? error.message : String(error)
      if (i + 1 < attempts) await sleep(delayMs)
    }
  }
  throw new Error(`dsh workspace pin failed: ${lastError}`)
}

/**
 * @param {string} launchToken
 */
async function mount(launchToken) {
  const grant = await fetchWorkspaceGrant(launchToken)
  await mkdir(WORKSPACE_DIR, { recursive: true })
  await writeCredentials(grant.token)
  await configureGitIdentity()
  if (existsSync(join(WORKSPACE_DIR, '.git'))) {
    await runGit(['remote', 'set-url', 'origin', githubHttpsOrigin(grant.owner, grant.name)])
    await runGit(['fetch', 'origin', grant.defaultBranch])
    await runGit(['checkout', grant.defaultBranch]).catch(() =>
      runGit(['checkout', '-B', grant.defaultBranch, `origin/${grant.defaultBranch}`]),
    )
    await runGit(['pull', '--ff-only', 'origin', grant.defaultBranch])
  } else {
    const tmp = join('/tmp', `harness-ws-${String(Date.now())}`)
    await rm(tmp, { recursive: true, force: true })
    await run('git', [
      'clone',
      '--depth=1',
      '--branch',
      grant.defaultBranch,
      githubHttpsOrigin(grant.owner, grant.name),
      tmp,
    ])
    await cp(tmp, WORKSPACE_DIR, { recursive: true })
    await rm(tmp, { recursive: true, force: true })
  }
  await ensureGitignore()
  await writeFile(join(process.env.HOME ?? homedir(), '.corenet-launch'), launchToken, { mode: 0o600 })
  await writeCorenetGuide(grant)
  startPushLoop()
  return grant
}

/** @param {string} token */
async function writeCredentials(token) {
  await writeFile(CREDENTIALS_FILE, `https://x-access-token:${token}@github.com\n`, { mode: 0o600 })
  await chmod(CREDENTIALS_FILE, 0o600)
  await run('git', ['config', '--global', 'credential.helper', `store --file=${CREDENTIALS_FILE}`])
}

async function configureGitIdentity() {
  await run('git', ['config', '--global', 'user.email', 'harness@cloudoi.io'])
  await run('git', ['config', '--global', 'user.name', 'Envon Harness'])
}

/**
 * @param {{ brief?: string }} grant
 */
async function writeCorenetGuide(grant) {
  const dir = join(WORKSPACE_DIR, '.cloudoi')
  await mkdir(dir, { recursive: true })
  if (grant.brief) {
    await writeFile(join(dir, 'brief.md'), `${grant.brief}\n`)
  }
  await writeFile(
    join(dir, 'CORENET.md'),
    [
      '# CloudOI CoreNet',
      '',
      'This workspace is the user GitHub repo. Public URL is `*.cloudoi.dev`, not localhost.',
      '',
      'If `brief.md` exists, that is the user request — implement it first.',
      '',
      'Publish the current GitHub tree and get the public URL:',
      '',
      '    curl -sS -X POST http://127.0.0.1:3081/corenet/publish',
      '',
      'Create CoreNet managed PostgreSQL (sets DATABASE_URL on the site, then redeploy):',
      '',
      '    curl -sS -X POST http://127.0.0.1:3081/corenet/database',
      '',
      'Do not install Postgres locally. Do not tell the user to open 127.0.0.1.',
      '',
    ].join('\n'),
  )
}

async function ensureGitignore() {
  const gitignore = join(WORKSPACE_DIR, '.gitignore')
  const required = ['.sessions/', '.dsh/', 'node_modules/']
  let current = ''
  if (existsSync(gitignore)) {
    current = await readFile(gitignore, 'utf8')
  }
  const missing = required.filter((line) => !current.split('\n').includes(line))
  if (missing.length === 0) return
  const next = `${current}${current.endsWith('\n') || current === '' ? '' : '\n'}${missing.join('\n')}\n`
  await writeFile(gitignore, next)
}

function startPushLoop() {
  if (pushTimer !== null) return
  const tick = () => {
    void pushOnce()
  }
  pushTimer = setInterval(tick, PUSH_INTERVAL_MS)
  if (typeof pushTimer.unref === 'function') pushTimer.unref()
}

async function pushOnce() {
  try {
    await runGit(['add', '-A'])
    const status = await runGit(['status', '--porcelain'])
    if (status.stdout.trim() === '') return
    await runGit(['commit', '-m', 'Envon Harness workspace'])
    await runGit(['push', 'origin', 'HEAD'])
  } catch (error) {
    process.stderr.write(`hosted-generate-web: git push skipped: ${redact(String(error))}\n`)
  }
}

/**
 * @param {string[]} args
 */
function runGit(args) {
  return run('git', ['-C', WORKSPACE_DIR, ...args])
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(`${command} ${args[0] ?? ''} exited ${String(code)}: ${redact(stderr.trim() || stdout.trim())}`))
    })
  })
}

/** @param {string} value */
export function redact(value) {
  return value.replace(/x-access-token:[^@\s]+/g, 'x-access-token:***')
}
