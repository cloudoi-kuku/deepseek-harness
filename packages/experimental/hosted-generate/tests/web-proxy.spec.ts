import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseCloneRemote, server } from '../example/azure/web-proxy.mjs'

process.env.GENERATE_TOKEN = 'op-token'
process.env.HARNESS_CORENET_ORIGIN = 'https://app.cloudoi.io'
process.env.HARNESS_LAUNCH_SECRET = 'unused-in-these-cases'
process.env.DSH_PORT = '1'

let origin = ''

beforeAll(() => new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address() as AddressInfo
    origin = `http://127.0.0.1:${String(address.port)}`
    resolve()
  })
}))

afterAll(() => new Promise<void>((resolve, reject) => {
  server.close((error) => {
    if (error) reject(error)
    else resolve()
  })
}))

describe('parseCloneRemote', () => {
  it('accepts a GitHub https URL from JSON or a form body', () => {
    expect(parseCloneRemote(
      JSON.stringify({ remoteUrl: 'https://github.com/ada/demo.git' }),
      'application/json',
    )).toBe('https://github.com/ada/demo.git')
    expect(parseCloneRemote(
      'remoteUrl=https%3A%2F%2Fgithub.com%2Fada%2Fdemo',
      'application/x-www-form-urlencoded',
    )).toBe('https://github.com/ada/demo')
  })

  it('rejects a non-GitHub URL and a token in the URL', () => {
    expect(parseCloneRemote(
      JSON.stringify({ remoteUrl: 'https://gitlab.com/ada/demo.git' }),
      'application/json',
    )).toBeNull()
    expect(parseCloneRemote(
      JSON.stringify({ remoteUrl: 'https://x-access-token:secret@github.com/ada/demo.git' }),
      'application/json',
    )).toBeNull()
  })
})

describe('web-proxy entry', () => {
  it('serves a landing instead of redirecting an unauthenticated browser to CoreNet', async () => {
    const response = await fetch(`${origin}/`, { headers: { accept: 'text/html' }, redirect: 'manual' })
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    const body = await response.text()
    expect(body).toContain('https://app.cloudoi.io/app/harness-launch')
    expect(body).toContain('Open Git IDE')
    expect(body).toContain('/clone')
  })

  it('returns 401 JSON without a CoreNet Location for non-HTML clients', async () => {
    const response = await fetch(`${origin}/`, { headers: { accept: 'application/json' }, redirect: 'manual' })
    expect(response.status).toBe(401)
    expect(response.headers.get('location')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'GENERATE_UNAUTHORIZED' },
    })
  })

  it('forwards GENERATE_TOKEN to dsh web without pinning a CoreNet workspace', async () => {
    const response = await fetch(`${origin}/`, {
      headers: { authorization: 'Bearer op-token' },
      redirect: 'manual',
    })
    expect(response.status).toBe(502)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).toContain('dsh web is not listening')
  })
})
