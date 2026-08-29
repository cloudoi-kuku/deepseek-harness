/**
 * Public reverse proxy for loopback `dsh web`.
 * Binds 0.0.0.0 so Azure Container Apps can ingress; dsh itself stays on 127.0.0.1
 * because the CLI refuses `--host 0.0.0.0`. GET /health is unauthenticated.
 * Access is a CoreNet/Hosting launch token (the CloudOI account) or GENERATE_TOKEN
 * for operators. Unauthenticated browsers redirect to CoreNet login when configured.
 */

import http from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchTokenFromRequest, validateLaunchToken } from './launch-token.mjs'

const GENERATE_PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'generate.html'))

const PORT = Number(process.env.PORT ?? 8080)
const TOKEN = process.env.GENERATE_TOKEN ?? ''
const UPSTREAM_PORT = Number(process.env.DSH_PORT ?? 3080)
const GENERATE_PORT = Number(process.env.GENERATE_PORT ?? 3081)
const UPSTREAM = { hostname: '127.0.0.1', port: UPSTREAM_PORT }
const GENERATE = { hostname: '127.0.0.1', port: GENERATE_PORT }
const LAUNCH_SECRET = process.env.HARNESS_LAUNCH_SECRET ?? ''
const CORENET_ORIGIN = (process.env.HARNESS_CORENET_ORIGIN ?? '').replace(/\/$/, '')

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { ok: true })
    return
  }
  const queryLaunch = url.searchParams.get('launch') ?? ''
  if (queryLaunch !== '' && validateLaunchToken(queryLaunch, LAUNCH_SECRET)) {
    const dest = url.pathname === '/' || url.pathname === '/new' ? '/new' : url.pathname
    res.writeHead(302, {
      location: dest,
      'set-cookie': `harness_launch=${encodeURIComponent(queryLaunch)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`,
    })
    res.end()
    return
  }
  if (!authorized(req)) {
    if (req.method === 'GET' && CORENET_ORIGIN !== '') {
      res.writeHead(302, { location: `${CORENET_ORIGIN}/app/harness-launch` })
      res.end()
      return
    }
    res.writeHead(401, {
      'www-authenticate': 'Basic realm="dsh-poc"',
      'content-type': 'application/json; charset=utf-8',
    })
    res.end(JSON.stringify({ error: { code: 'GENERATE_UNAUTHORIZED', message: 'CoreNet launch token or operator token is required' } }))
    return
  }
  if (req.method === 'GET' && url.pathname === '/new') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(GENERATE_PAGE)
    return
  }
  const generate = url.pathname === '/generate' || url.pathname.startsWith('/sessions/')
  forward(req, res, generate ? GENERATE : UPSTREAM)
})

server.on('upgrade', (req, socket, head) => {
  if (!authorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="dsh-poc"\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const headers = downstreamHeaders(req)
  const upstream = http.request({ ...UPSTREAM, path: req.url, method: req.method, headers })
  upstream.on('upgrade', (upRes, upSocket, upHead) => {
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
  upstream.on('error', () => {
    socket.destroy()
  })
  upstream.end()
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
    res.end(target.port === GENERATE_PORT ? 'generate server is not listening' : 'dsh web is not listening')
  })
  req.pipe(upstream)
}

/** @param {http.IncomingMessage} req */
function authorized(req) {
  if (LAUNCH_SECRET !== '' && validateLaunchToken(launchTokenFromRequest(req), LAUNCH_SECRET)) {
    return true
  }
  if (TOKEN === '') return LAUNCH_SECRET === ''
  const auth = req.headers.authorization ?? ''
  if (auth === `Bearer ${TOKEN}`) return true
  if (!auth.startsWith('Basic ')) return false
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  const password = colon === -1 ? decoded : decoded.slice(colon + 1)
  return password === TOKEN
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

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`hosted-generate-web: http://0.0.0.0:${String(PORT)}/ → 127.0.0.1:${String(UPSTREAM_PORT)}\n`)
})
