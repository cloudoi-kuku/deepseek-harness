/**
 * Keyless snapshot of the hosted-generate HTTP artifact. The mock LLM writes
 * a fixed index.html; no provider key is required.
 */

import { readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { loadHostedGenerate } from '../boot.ts'

const expectedPath = fileURLToPath(new URL('./snapshots/static-site/artifact.expected.json', import.meta.url))
const INDEX_HTML = '<h1>POC</h1>'

let home: string | undefined
let ctx: Awaited<ReturnType<typeof loadHostedGenerate>>['ctx'] | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

describe('hosted-generate snapshot', () => {
  it('pins the mock-written static artifact', async () => {
    const mock = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      apiKey: 'snapshot-key',
      toolName: 'write',
      toolArguments: JSON.stringify({ file_path: 'index.html', content: INDEX_HTML }),
      successText: 'done',
    })
    process.env.DEEPSEEK_API_KEY = 'snapshot-key'
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
      const { sessionId } = await created.json() as { sessionId: string }
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        const status = await fetch(`http://127.0.0.1:${String(port)}/sessions/${sessionId}`)
        const body = await status.json() as { status: string }
        if (body.status === 'completed') break
        if (body.status !== 'running') throw new Error(`settled ${body.status}`)
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      const artifact = await fetch(`http://127.0.0.1:${String(port)}/sessions/${sessionId}/artifact`)
      const payload = await artifact.json() as { files: Record<string, string> }
      const expected = JSON.parse(await readFile(expectedPath, 'utf8')) as { files: Record<string, string> }
      expect(payload.files).toEqual(expected.files)
    } finally {
      await mock.close()
    }
  }, 25_000)
})
