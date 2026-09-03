import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { loadHostedGenerate } from '../boot.ts'

const hasKey = Boolean(process.env.DEEPSEEK_API_KEY)

let home: string | undefined
let ctx: Awaited<ReturnType<typeof loadHostedGenerate>>['ctx'] | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

describe.skipIf(!hasKey)('hosted-generate live model', () => {
  it('generates at least one UTF-8 file from a tiny static-site brief', async () => {
    const loaded = await loadHostedGenerate()
    ctx = loaded.ctx
    home = loaded.home
    const port = ctx.webServer.port
    const created = await fetch(`http://127.0.0.1:${String(port)}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Single-file HTML page that says Hello in an h1. No images.' }),
    })
    expect(created.status).toBe(202)
    const { sessionId } = await created.json() as { sessionId: string }
    const deadline = Date.now() + 90_000
    let status = 'running'
    while (Date.now() < deadline) {
      const response = await fetch(`http://127.0.0.1:${String(port)}/sessions/${sessionId}`)
      const body = await response.json() as { status: string }
      status = body.status
      if (status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    expect(status).toBe('completed')
    const artifact = await fetch(`http://127.0.0.1:${String(port)}/sessions/${sessionId}/artifact`)
    const payload = await artifact.json() as { files: Record<string, string> }
    expect(Object.keys(payload.files).length).toBeGreaterThan(0)
    expect(Object.values(payload.files).some(text => /html/i.test(text))).toBe(true)
  }, 100_000)
})
