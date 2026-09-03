/**
 * In-process generate occupancy, artifact collection, HTTP, and cost caps.
 * The example keyless smoke boots the shipped YAML through the Loader.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import HostedGenerateService, {
  GenerateSessionId,
  HostedGenerateError,
  internals,
} from '../src/index.ts'
import { mountGenerateRoutes, readJsonBody } from '../src/http.ts'
import { createWorkspace, wipeWorkspace } from '../src/workspace.ts'
import { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

const roots: string[] = []
const originalStdout = internals.stdout

afterEach(async () => {
  internals.stdout = originalStdout
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function waitTerminal(
  service: HostedGenerateService,
  sessionId: ReturnType<typeof GenerateSessionId>,
): Promise<ReturnType<HostedGenerateService['status']>> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const status = service.status(sessionId)
    if (status.status !== 'running') return status
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  throw new Error(`generation ${sessionId} did not settle`)
}

async function setup(
  script: ConstructorParameters<typeof MockAdapter>[0],
  config: ConstructorParameters<typeof HostedGenerateService>[1] & { http?: boolean; printListen?: boolean } = {
    provider: 'mock',
    model: 'mock',
  },
) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-hosted-generate-'))
  roots.push(root)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(ToolFs)
  if (config.http === true) {
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  }
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const { http: _http, ...serviceConfig } = config
  const fiber = await ctx.plugin(HostedGenerateService, {
    workspaceParent: root,
    sessionTimeoutMs: 5_000,
    ...serviceConfig,
  })
  await fiber.await()
  return { ctx, root, adapter }
}

describe('HostedGenerateService', () => {
  it('writes a workspace file map and wipes the disposable directory', async () => {
    const { ctx, root } = await setup([
      toolCallResponse('c1', 'write', { file_path: 'index.html', content: '<h1>ok</h1>' }),
      textResponse('done'),
    ])
    const started = await ctx.hostedGenerate.start({ prompt: 'a landing page', tenantId: 't1' })
    const status = await waitTerminal(ctx.hostedGenerate, started.sessionId)
    expect(status).toMatchObject({
      tenantId: 't1',
      status: 'completed',
      fileCount: 1,
    })
    expect(ctx.hostedGenerate.artifact(started.sessionId).files).toEqual({
      'index.html': '<h1>ok</h1>',
    })
    const leftover = await import('node:fs/promises').then(fs => fs.readdir(root))
    expect(leftover.every(name => !name.startsWith('dsh-generate-'))).toBe(true)
    await ctx.fiber.dispose()
  })

  it('rejects an empty or oversized prompt and unknown session reads', async () => {
    const { ctx } = await setup([textResponse('unused')])
    await expect(ctx.hostedGenerate.start({ prompt: '   ' })).rejects.toMatchObject({
      code: 'GENERATE_INVALID_REQUEST',
    })
    await expect(ctx.hostedGenerate.start({ prompt: 'x'.repeat(20_000) })).rejects.toMatchObject({
      code: 'GENERATE_INVALID_REQUEST',
    })
    expect(() => ctx.hostedGenerate.status(GenerateSessionId('missing'))).toThrow(HostedGenerateError)
    expect(() => ctx.hostedGenerate.artifact(GenerateSessionId('missing'))).toThrow(HostedGenerateError)
    await ctx.fiber.dispose()
  })

  it('refuses a second start while one generation is running', async () => {
    const { ctx } = await setup(['hang'], { provider: 'mock', model: 'mock', sessionTimeoutMs: 2_000 })
    const first = await ctx.hostedGenerate.start({ prompt: 'one' })
    await expect(ctx.hostedGenerate.start({ prompt: 'two' })).rejects.toMatchObject({
      code: 'GENERATE_BUSY',
    })
    expect(ctx.hostedGenerate.status(first.sessionId).status).toBe('running')
    expect(() => ctx.hostedGenerate.artifact(first.sessionId)).toThrow(HostedGenerateError)
    await ctx.fiber.dispose()
  })

  it('cancels a hung generation at sessionTimeoutMs', async () => {
    const { ctx } = await setup(['hang'], { provider: 'mock', model: 'mock', sessionTimeoutMs: 40 })
    const started = await ctx.hostedGenerate.start({ prompt: 'hang' })
    const status = await waitTerminal(ctx.hostedGenerate, started.sessionId)
    expect(status.status).toBe('cancelled')
    expect(status.error?.code).toBe('GENERATE_TIMEOUT')
    await ctx.fiber.dispose()
  })

  it('drops the oldest terminal record when retention is full', async () => {
    const { ctx } = await setup(
      [textResponse('one'), textResponse('two')],
      { provider: 'mock', model: 'mock', maxRetainedSessions: 1 },
    )
    const first = await ctx.hostedGenerate.start({ prompt: 'one' })
    await waitTerminal(ctx.hostedGenerate, first.sessionId)
    const second = await ctx.hostedGenerate.start({ prompt: 'two' })
    await waitTerminal(ctx.hostedGenerate, second.sessionId)
    expect(() => ctx.hostedGenerate.status(first.sessionId)).toThrow(HostedGenerateError)
    expect(ctx.hostedGenerate.status(second.sessionId).status).toBe('completed')
    await ctx.fiber.dispose()
  })

  it('serves generate and session HTTP on the loopback web server', async () => {
    const lines: string[] = []
    internals.stdout = { write(chunk: string) { lines.push(chunk); return true } }
    const { ctx } = await setup(
      [
        toolCallResponse('c1', 'write', { file_path: 'index.html', content: '<p>hi</p>' }),
        textResponse('done'),
      ],
      { provider: 'mock', model: 'mock', http: true, printListen: true, authToken: 'secret' },
    )
    const port = ctx.webServer.port
    expect(lines.some(line => line.includes(`http://127.0.0.1:${String(port)}/generate`))).toBe(true)

    const unauthorized = await fetch(`http://127.0.0.1:${String(port)}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(unauthorized.status).toBe(401)

    const created = await fetch(`http://127.0.0.1:${String(port)}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ prompt: 'a site', tenantId: 'acme' }),
    })
    expect(created.status).toBe(202)
    const { sessionId } = await created.json() as { sessionId: string }

    const deadline = Date.now() + 10_000
    let statusPayload: { status: string }
    do {
      const statusResponse = await fetch(`http://127.0.0.1:${String(port)}/sessions/${sessionId}`, {
        headers: { authorization: 'Bearer secret' },
      })
      statusPayload = await statusResponse.json() as { status: string }
      if (statusPayload.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 15))
    } while (Date.now() < deadline)
    expect(statusPayload.status).toBe('completed')

    const artifactResponse = await fetch(`http://127.0.0.1:${String(port)}/sessions/${sessionId}/artifact`, {
      headers: { authorization: 'Bearer secret' },
    })
    expect(artifactResponse.status).toBe(200)
    await expect(artifactResponse.json()).resolves.toMatchObject({
      files: { 'index.html': '<p>hi</p>' },
    })

    const badMethod = await fetch(`http://127.0.0.1:${String(port)}/generate`, {
      method: 'GET',
      headers: { authorization: 'Bearer secret' },
    })
    expect(badMethod.status).toBe(405)
    const missing = await fetch(`http://127.0.0.1:${String(port)}/sessions/nope`, {
      headers: { authorization: 'Bearer secret' },
    })
    expect(missing.status).toBe(404)
    const invalidPath = await fetch(`http://127.0.0.1:${String(port)}/sessions/`, {
      headers: { authorization: 'Bearer secret' },
    })
    expect(invalidPath.status).toBe(404)
    await ctx.fiber.dispose()
  })

  it('rejects malformed generate HTTP bodies and non-GET session methods', async () => {
    const { ctx } = await setup([textResponse('unused')], {
      provider: 'mock',
      model: 'mock',
      http: true,
    })
    const port = ctx.webServer.port
    const headers = { 'content-type': 'application/json' }
    const missing = await fetch(`http://127.0.0.1:${String(port)}/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })
    expect(missing.status).toBe(400)
    const badTenant = await fetch(`http://127.0.0.1:${String(port)}/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'ok', tenantId: 1 }),
    })
    expect(badTenant.status).toBe(400)
    const notJson = await fetch(`http://127.0.0.1:${String(port)}/generate`, {
      method: 'POST',
      headers,
      body: '{',
    })
    expect(notJson.status).toBe(400)
    const sessionMethod = await fetch(`http://127.0.0.1:${String(port)}/sessions/x`, { method: 'POST' })
    expect(sessionMethod.status).toBe(405)
    await ctx.fiber.dispose()
  })

  it('fails start when no Agent factory is registered', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hosted-generate-nofactory-'))
    roots.push(root)
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(ToolFs)
    ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
    await ctx.plugin(HostedGenerateService, { provider: 'mock', model: 'mock', workspaceParent: root })
    await expect(ctx.hostedGenerate.start({ prompt: 'x' })).rejects.toMatchObject({
      code: 'GENERATE_FAILED',
    })
    await ctx.fiber.dispose()
  })

  it('records a failed generation when the model script is exhausted', async () => {
    const { ctx } = await setup([])
    const started = await ctx.hostedGenerate.start({ prompt: 'x' })
    const status = await waitTerminal(ctx.hostedGenerate, started.sessionId)
    expect(status.status).toBe('failed')
    expect(status.error?.code).toBe('GENERATE_FAILED')
    await ctx.fiber.dispose()
  })

  it('sends the user prompt without extra guidance when taskGuidance is empty', async () => {
    const { ctx, adapter } = await setup([textResponse('done')], {
      provider: 'mock',
      model: 'mock',
      taskGuidance: '',
    })
    const started = await ctx.hostedGenerate.start({ prompt: 'plain brief' })
    await waitTerminal(ctx.hostedGenerate, started.sessionId)
    const last = adapter.requests.at(-1)
    expect(JSON.stringify(last)).toContain('plain brief')
    expect(JSON.stringify(last)).not.toContain('User request:')
    await ctx.fiber.dispose()
  })

  it('cancels at maxSteps and fails when a written file exceeds maxFileBytes', async () => {
    const { ctx } = await setup(
      [
        toolCallResponse('c1', 'write', { file_path: 'a.html', content: 'aaaa' }),
        toolCallResponse('c2', 'write', { file_path: 'b.html', content: 'bbbb' }),
        textResponse('done'),
      ],
      { provider: 'mock', model: 'mock', maxSteps: 1 },
    )
    const started = await ctx.hostedGenerate.start({ prompt: 'steps' })
    const status = await waitTerminal(ctx.hostedGenerate, started.sessionId)
    expect(status.status).toBe('cancelled')
    await ctx.fiber.dispose()

    const oversized = await setup(
      [
        toolCallResponse('c1', 'write', { file_path: 'big.html', content: 'abcdefghij' }),
        textResponse('done'),
      ],
      { provider: 'mock', model: 'mock', maxFileBytes: 4 },
    )
    const big = await oversized.ctx.hostedGenerate.start({ prompt: 'big' })
    const bigStatus = await waitTerminal(oversized.ctx.hostedGenerate, big.sessionId)
    expect(bigStatus.status).toBe('failed')
    expect(bigStatus.error?.code).toBe('GENERATE_TOO_LARGE')
    await oversized.ctx.fiber.dispose()
  })

  it('returns HTTP 409 when a generation is already running and 500 when start fails', async () => {
    const busy = await setup(['hang'], { provider: 'mock', model: 'mock', http: true, sessionTimeoutMs: 2_000 })
    const port = busy.ctx.webServer.port
    const first = await fetch(`http://127.0.0.1:${String(port)}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'one' }),
    })
    expect(first.status).toBe(202)
    const second = await fetch(`http://127.0.0.1:${String(port)}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'two' }),
    })
    expect(second.status).toBe(409)
    await busy.ctx.fiber.dispose()

    const root = await mkdtemp(join(tmpdir(), 'dsh-hosted-generate-http-fail-'))
    roots.push(root)
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(ToolFs)
    ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
    await ctx.plugin(HostedGenerateService, { provider: 'mock', model: 'mock', workspaceParent: root })
    const failed = await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(failed.status).toBe(500)
    await ctx.fiber.dispose()
  })

  it('maps unexpected route throws to GENERATE_FAILED and honors query strings', async () => {
    const ctx = new Context()
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const dispose = mountGenerateRoutes(ctx.webServer, {
      async start() { throw new Error('boom') },
      status() { throw 'nope' },
      artifact() { throw new Error('missing') },
    }, '', 1024)
    const port = ctx.webServer.port
    const created = await fetch(`http://127.0.0.1:${String(port)}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(created.status).toBe(500)
    await expect(created.json()).resolves.toMatchObject({ error: { message: 'boom' } })
    const status = await fetch(`http://127.0.0.1:${String(port)}/sessions/x?wait=1`)
    expect(status.status).toBe(500)
    const artifact = await fetch(`http://127.0.0.1:${String(port)}/sessions/x/artifact`)
    expect(artifact.status).toBe(500)
    dispose()
    await ctx.fiber.dispose()
  })
})

describe('workspace helpers and JSON body', () => {
  it('creates and wipes a workspace directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-generate-parent-'))
    roots.push(parent)
    const created = await createWorkspace(parent)
    await writeFile(join(created, 'keep.txt'), 'x')
    await wipeWorkspace(created)
    await expect(mkdir(created)).resolves.toBeUndefined()
    await wipeWorkspace(join(parent, 'missing-dir'))
  })

  it('parses JSON bodies and rejects oversized or invalid payloads', async () => {
    const valid = Readable.from(['{"prompt":"ok"}']) as IncomingMessage
    await expect(readJsonBody(valid, 100)).resolves.toEqual({ prompt: 'ok' })
    const empty = Readable.from([]) as IncomingMessage
    await expect(readJsonBody(empty, 100)).resolves.toEqual({})
    const invalid = Readable.from(['{']) as IncomingMessage
    await expect(readJsonBody(invalid, 100)).rejects.toMatchObject({ code: 'GENERATE_INVALID_REQUEST' })
    const huge = Readable.from(['x'.repeat(20)]) as IncomingMessage
    await expect(readJsonBody(huge, 4)).rejects.toMatchObject({ code: 'GENERATE_INVALID_REQUEST' })
  })
})
