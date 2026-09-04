/**
 * Public reverse proxy for loopback `dsh web`.
 * Binds 0.0.0.0 so Azure Container Apps can ingress; dsh itself stays on 127.0.0.1
 * because the CLI refuses `--host 0.0.0.0`. GET /health is unauthenticated.
 * Access is a CoreNet/Hosting launch token (the CloudOI account) or GENERATE_TOKEN
 * for the standalone Git IDE. Unauthenticated browsers get a landing that offers
 * both; they are not redirected to CoreNet.
 */

import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { launchTokenFromRequest, MAXIMUM_LIFETIME_S, validateLaunchToken } from './launch-token.mjs'
import {
  adoptDshWorkspace,
  adoptGitWorkspace,
  ensureGithubWorkspace,
  parseGithubHttpsRemote,
  WORKSPACE_DIR,
} from './workspace-github.mjs'

const PORT = Number(process.env.PORT ?? 8080)

function dshPort() {
  return Number(process.env.DSH_PORT ?? 3080)
}

function generatePort() {
  return Number(process.env.GENERATE_PORT ?? 3081)
}

function upstream() {
  return { hostname: '127.0.0.1', port: dshPort() }
}

function generateUpstream() {
  return { hostname: '127.0.0.1', port: generatePort() }
}

let pinInflight = null
let pinnedTitle = null

/**
 * @returns {string}
 */
function operatorToken() {
  return process.env.GENERATE_TOKEN ?? ''
}

/**
 * @returns {string}
 */
function launchSecret() {
  return process.env.HARNESS_LAUNCH_SECRET ?? ''
}

/**
 * @returns {string}
 */
function corenetOrigin() {
  return (process.env.HARNESS_CORENET_ORIGIN ?? '').replace(/\/$/, '')
}

const server = http.createServer((req, res) => {
  void handle(req, res)
})

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { ok: true })
    return
  }
  const queryLaunch = url.searchParams.get('launch') ?? ''
  if (queryLaunch !== '' && validateLaunchToken(queryLaunch, launchSecret())) {
    try {
      await pinGithubWorkspace(queryLaunch)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'workspace mount failed'
      const code = /dsh workspace pin/.test(message) ? 'WORKSPACE_PIN_FAILED' : 'WORKSPACE_MOUNT_FAILED'
      json(res, 502, { error: { code, message } })
      return
    }
    res.writeHead(302, {
      location: '/',
      'set-cookie': `harness_launch=${encodeURIComponent(queryLaunch)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${String(MAXIMUM_LIFETIME_S)}`,
    })
    res.end()
    return
  }
  if (!authorized(req)) {
    if (req.method === 'GET' && wantsHtml(req)) {
      html(res, 200, landingPage())
      return
    }
    res.writeHead(401, {
      'www-authenticate': 'Basic realm="dsh-poc"',
      'content-type': 'application/json; charset=utf-8',
    })
    res.end(JSON.stringify({ error: { code: 'GENERATE_UNAUTHORIZED', message: 'CoreNet launch token or operator token is required' } }))
    return
  }
  if (req.method === 'GET' && (url.pathname === '/new' || url.pathname === '/new/')) {
    res.writeHead(302, { location: '/' })
    res.end()
    return
  }
  if (url.pathname === '/clone' || url.pathname === '/clone/') {
    await handleClone(req, res)
    return
  }
  if (req.method === 'GET' && url.pathname === '/') {
    try {
      const launch = launchTokenFromRequest(req)
      if (launchSecret() !== '' && validateLaunchToken(launch, launchSecret())) {
        await pinGithubWorkspace(launch)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'workspace pin failed'
      json(res, 502, { error: { code: 'WORKSPACE_PIN_FAILED', message } })
      return
    }
  }
  const generate = url.pathname === '/generate' || url.pathname.startsWith('/sessions/')
  forward(req, res, generate ? generateUpstream() : upstream())
}

/**
 * Clone the GitHub grant for this launch token and register it as the dsh workspace.
 * @param {string} launchToken
 */
async function pinGithubWorkspace(launchToken) {
  const grant = await ensureGithubWorkspace(launchToken)
  await pinDshWorkspace(`${grant.owner}/${grant.name}`)
}

/**
 * Idempotent dsh `workspace/create` for `/workspace`. Concurrent callers share one attempt.
 * @param {string} title
 */
function pinDshWorkspace(title) {
  if (pinnedTitle === title) return Promise.resolve()
  if (pinInflight !== null) return pinInflight
  pinInflight = adoptDshWorkspace({ path: WORKSPACE_DIR, title }).then(() => {
    pinnedTitle = title
  }).finally(() => {
    pinInflight = null
  })
  return pinInflight
}

server.on('upgrade', (req, socket, head) => {
  if (!authorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="dsh-poc"\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const headers = downstreamHeaders(req)
  const target = upstream()
  const upstreamReq = http.request({ ...target, path: req.url, method: req.method, headers })
  upstreamReq.on('upgrade', (upRes, upSocket, upHead) => {
    const lines = ['HTTP/1.1 101 Switching Protocols']
    for (const [name, value] of Object.entries(upRes.headers)) {
      if (value === undefined) continue
      lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head.length > 0) upSocket.write(head)
    if (upHead.length > 0) socket.write(upHead)
    upSocket.pipe(socket)
    socket.pipe(upSocket)
  })
  upstreamReq.on('error', () => {
    socket.destroy()
  })
  upstreamReq.end()
})

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {{ hostname: string, port: number }} target
 */
function forward(req, res, target) {
  const headers = downstreamHeaders(req)
  const upstream = http.request({ ...target, path: req.url, method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers)
    up.pipe(res)
  })
  upstream.setTimeout(0)
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(target.port === generatePort() ? 'generate server is not listening' : 'dsh web is not listening')
  })
  req.pipe(upstream)
}

/** @param {http.IncomingMessage} req */
function authorized(req) {
  const secret = launchSecret()
  if (secret !== '' && validateLaunchToken(launchTokenFromRequest(req), secret)) {
    return true
  }
  const token = operatorToken()
  if (token === '') return secret === ''
  const auth = req.headers.authorization ?? ''
  if (auth === `Bearer ${token}`) return true
  if (!auth.startsWith('Basic ')) return false
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  const password = colon === -1 ? decoded : decoded.slice(colon + 1)
  return password === token
}

/** @param {http.IncomingMessage} req */
function wantsHtml(req) {
  const accept = req.headers.accept ?? ''
  return accept.includes('text/html')
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleClone(req, res) {
  if (req.method === 'GET') {
    html(res, 200, clonePage())
    return
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or POST /clone' } })
    return
  }
  const remoteUrl = parseCloneRemote(await readBody(req), req.headers['content-type'] ?? '')
  if (remoteUrl === null) {
    json(res, 400, {
      error: {
        code: 'INVALID_REMOTE',
        message: 'remoteUrl must be an https://github.com/<owner>/<repo> URL',
      },
    })
    return
  }
  try {
    await adoptGitWorkspace({ remoteUrl, checkoutParent: WORKSPACE_DIR })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'workspace createGit failed'
    json(res, 502, { error: { code: 'WORKSPACE_CLONE_FAILED', message } })
    return
  }
  res.writeHead(302, { location: '/' })
  res.end()
}

/**
 * @param {string} body
 * @param {string} contentType
 * @returns {string | null}
 */
export function parseCloneRemote(body, contentType) {
  let remoteUrl = ''
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(body)
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.remoteUrl === 'string') {
        remoteUrl = parsed.remoteUrl
      }
    } catch {
      return null
    }
  } else {
    remoteUrl = new URLSearchParams(body).get('remoteUrl') ?? ''
  }
  return parseGithubHttpsRemote(remoteUrl) === null ? null : remoteUrl.trim()
}

/** @param {http.IncomingMessage} req */
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function landingPage() {
  const origin = corenetOrigin()
  const token = operatorToken()
  const secret = launchSecret()
  const standalone = token !== '' || secret === ''
  const corenet = origin === ''
    ? ''
    : `<p><a class="btn" href="${escapeHtml(origin)}/app/harness-launch">Sign in with CloudOI</a></p>`
  const ide = standalone
    ? `<p><a class="btn secondary" href="/">Open Git IDE</a></p>
    <p><a href="/clone">Clone a GitHub repository</a></p>`
    : '<p>Open this URL from CloudOI, or set GENERATE_TOKEN to use the Git IDE without CoreNet.</p>'
  return page('Envon Harness', `
    <h1>Envon Harness</h1>
    <p>DeepSeek Harness on this host. Sign in with CloudOI to attach your CoreNet GitHub workspace, or open the Git IDE with the operator token.</p>
    ${corenet}
    ${ide}
  `)
}

function clonePage() {
  return page('Clone a GitHub repository', `
    <h1>Clone a GitHub repository</h1>
    <p>Creates a dsh workspace from a public GitHub https URL. Private repos need a CoreNet login so the clone grant can supply credentials.</p>
    <form method="post" action="/clone">
      <label for="remoteUrl">GitHub URL</label>
      <input id="remoteUrl" name="remoteUrl" type="url" required placeholder="https://github.com/owner/repo" />
      <button type="submit">Clone and open</button>
    </form>
    <p><a href="/">Back to Git IDE</a></p>
  `)
}

/**
 * @param {string} title
 * @param {string} body
 */
function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
    main { max-width: 44rem; margin: 0 auto; padding: 2.5rem 1.25rem; }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
    p { color: #94a3b8; line-height: 1.5; }
    a { color: #7dd3fc; }
    label { display: block; margin: 1rem 0 0.4rem; }
    input { width: 100%; box-sizing: border-box; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid #334155; background: #1e293b; color: inherit; }
    button, .btn { display: inline-block; margin-top: 1rem; padding: 0.6rem 1.1rem; border: 0; border-radius: 0.5rem; background: #38bdf8; color: #0f172a; font-weight: 600; text-decoration: none; cursor: pointer; }
    .btn.secondary { background: #334155; color: #e2e8f0; }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} body
 */
function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** @param {http.IncomingMessage} req */
function downstreamHeaders(req) {
  const headers = { ...req.headers }
  delete headers.authorization
  headers['x-forwarded-proto'] = 'https'
  if (typeof req.headers.host === 'string') headers['x-forwarded-host'] = req.headers.host
  return headers
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function isMainModule() {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return import.meta.url === pathToFileURL(entry).href
}

if (isMainModule()) {
  server.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(`hosted-generate-web: http://0.0.0.0:${String(PORT)}/ → 127.0.0.1:${String(dshPort())}\n`)
  })
}

export { server, handle, authorized, wantsHtml, landingPage }
