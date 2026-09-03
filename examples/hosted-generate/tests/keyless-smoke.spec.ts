import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { loadHostedGenerate } from '../boot.ts'

const INDEX_HTML = '<h1>POC</h1>'

let home: string | undefined
let ctx: Awaited<ReturnType<typeof loadHostedGenerate>>['ctx'] | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

async function waitCompleted(port: number, sessionId: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${String(port)}/sessions/${sessionId}`)
    const body = await response.json() as { status: string; error?: { message: string } }
    if (body.status === 'completed') return
    if (body.status !== 'running') {
      throw new Error(`generation settled as ${body.status}: ${body.error?.message ?? ''}`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('generation did not complete')
}

describe('hosted-generate keyless smoke', () => {
  it('boots the example YAML and returns a written index.html artifact', async () => {
    const mock = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      apiKey: 'keyless-smoke-no-call',
      toolName: 'write',
      toolArguments: JSON.stringify({ file_path: 'index.html', content: INDEX_HTML }),
      successText: 'done',
    })
    process.env.DEEPSEEK_API_KEY = 'keyless-smoke-no-call'
    process.env.DEEPSEEK_BASE_URL = mock.baseURL
    try {
      const loaded = await loadHostedGenerate()
      ctx = loaded.ctx
      home = loaded.home
      const port = ctx.webServer.port
      const created = await fetch(`http://127.0.0.1:${String(port)}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'a one-page hello site' }),
      })
      expect(created.status).toBe(202)
      const { sessionId } = await created.json() as { sessionId: string }
      await waitCompleted(port, sessionId)
      const artifact = await fetch(`http://127.0.0.1:${String(port)}/sessions/${sessionId}/artifact`)
      expect(artifact.status).toBe(200)
      await expect(artifact.json()).resolves.toMatchObject({
        files: { 'index.html': INDEX_HTML },
      })
    } finally {
      await mock.close()
    }
  }, 25_000)
})
