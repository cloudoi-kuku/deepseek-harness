/**
 * Loopback CoreNet actions for dsh (publish *.cloudoi.dev, managed Postgres).
 * Reads the launch token written at workspace mount; the agent curls 127.0.0.1
 * and never holds the GitHub or CoreNet JWT.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CORENET = (process.env.CORENET_FROM_HARNESS_URL ?? '').replace(/\/$/, '')
export const LAUNCH_TOKEN_FILE =
  process.env.HARNESS_LAUNCH_TOKEN_FILE ?? join(process.env.HOME ?? homedir(), '.corenet-launch')

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 */
export async function handleCorenet(req, res, url) {
  try {
    await routeCorenet(req, res, url)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    json(res, 502, { error: { code: 'CORENET_FAILED', message } })
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 */
async function routeCorenet(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/corenet/status') {
    json(res, 200, {
      ok: true,
      publish: 'POST /corenet/publish',
      database: 'POST /corenet/database',
      publicUrl: '*.cloudoi.dev after publish — not localhost',
    })
    return
  }
  if (req.method === 'POST' && url.pathname === '/corenet/publish') {
    const body = await coreNet('POST', '/api/ai-build/from-harness/publish')
    json(res, 200, body)
    return
  }
  if (req.method === 'POST' && url.pathname === '/corenet/database') {
    const body = await coreNet('POST', '/api/ai-build/from-harness/database')
    json(res, 200, body)
    return
  }
  json(res, 404, { error: { code: 'CORENET_NOT_FOUND', message: 'unknown /corenet path' } })
}

/**
 * @param {string} method
 * @param {string} path
 */
async function coreNet(method, path) {
  if (CORENET === '') {
    throw new Error('CORENET_FROM_HARNESS_URL is not set')
  }
  const token = (await readFile(LAUNCH_TOKEN_FILE, 'utf8')).trim()
  if (token === '') {
    throw new Error('launch token is missing; open Envon from CoreNet')
  }
  const response = await fetch(`${CORENET}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  })
  const raw = await response.text()
  let parsed = null
  try {
    parsed = raw === '' ? null : JSON.parse(raw)
  } catch {
    parsed = null
  }
  if (!response.ok) {
    const detail =
      parsed && typeof parsed === 'object' && typeof parsed.detail === 'string'
        ? parsed.detail
        : raw.slice(0, 400)
    throw new Error(detail || `CoreNet ${path} failed (${String(response.status)})`)
  }
  return parsed
}

/**
 * @param {import('node:http').ServerResponse} res
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
