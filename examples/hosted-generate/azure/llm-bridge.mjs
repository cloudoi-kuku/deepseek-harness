/**
 * Loopback OpenAI-compatible bridge so pi-ai can reach Grok without Azure
 * `api-version` query support. Prefers Envon Foundry deployment `grok-4-3`
 * (private PE on the CAE VNet); `XAI_API_KEY` without `FOUNDRY_API_KEY` uses
 * `https://api.x.ai/v1` instead. Binds 127.0.0.1 only.
 */

import http from 'node:http'
import { Readable } from 'node:stream'

const PORT = Number(process.env.LLM_BRIDGE_PORT ?? 4000)
const FOUNDRY_KEY = process.env.FOUNDRY_API_KEY ?? ''
const XAI_KEY = process.env.XAI_API_KEY ?? ''
const FOUNDRY_ENDPOINT = (process.env.FOUNDRY_ENDPOINT ?? 'https://aif-envon-prd-eus2-01.cognitiveservices.azure.com').replace(/\/$/, '')
const DEPLOYMENT = process.env.FOUNDRY_DEPLOYMENT ?? 'grok-4-3'
const API_VERSION = process.env.AI_API_VERSION ?? '2024-05-01-preview'
const MAX_BODY = 32 * 1024 * 1024

const target = resolveTarget()

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
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, backend: target.backend }))
    return
  }
  if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { message: 'path is not /chat/completions' } }))
    return
  }
  try {
    const raw = await readBody(req)
    const body = rewriteModel(raw, target.model)
    const upstream = await fetch(target.url, {
      method: 'POST',
      headers: target.headers,
      body,
      signal: AbortSignal.timeout(300_000),
    })
    const headers = {}
    for (const [name, value] of upstream.headers) {
      if (name === 'transfer-encoding' || name === 'connection') continue
      headers[name] = value
    }
    res.writeHead(upstream.status, headers)
    if (upstream.body === null) {
      res.end()
      return
    }
    Readable.fromWeb(upstream.body).pipe(res)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`llm-bridge: ${message}\n`)
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    }
    res.end(JSON.stringify({ error: { message } }))
  }
}

function resolveTarget() {
  if (FOUNDRY_KEY !== '') {
    const url = new URL(`${FOUNDRY_ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions`)
    url.searchParams.set('api-version', API_VERSION)
    return {
      backend: 'foundry',
      url,
      model: DEPLOYMENT,
      headers: {
        'api-key': FOUNDRY_KEY,
        'content-type': 'application/json',
      },
    }
  }
  if (XAI_KEY !== '') {
    return {
      backend: 'xai',
      url: new URL('https://api.x.ai/v1/chat/completions'),
      model: 'grok-4.3',
      headers: {
        authorization: `Bearer ${XAI_KEY}`,
        'content-type': 'application/json',
      },
    }
  }
  throw new Error('FOUNDRY_API_KEY or XAI_API_KEY is required')
}

/**
 * @param {Buffer} raw
 * @param {string} model
 */
function rewriteModel(raw, model) {
  if (raw.byteLength === 0) return JSON.stringify({ model })
  try {
    const parsed = JSON.parse(raw.toString('utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      parsed.model = model
      return JSON.stringify(parsed)
    }
  } catch {
    // Upstream sees the original bytes when the body is not JSON.
  }
  return raw
}

/** @param {http.IncomingMessage} req */
async function readBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk)
    total += buf.byteLength
    if (total > MAX_BODY) throw new Error('request body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`llm-bridge: http://127.0.0.1:${String(PORT)}/v1 → ${target.backend} ${target.url.origin}${target.url.pathname}\n`)
})
