/**
 * Keyless loopback generate server for manual curl. Uses the mock LLM so a
 * POST writes `index.html` without a provider key or Azure spend.
 */

import { rm } from 'node:fs/promises'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { loadHostedGenerate } from './boot.ts'

const INDEX_HTML = '<h1>POC</h1>'

const mock = await startMockLlmServer({
  sequence: ['tool_call_success', 'success'],
  apiKey: 'hosted-generate-poc',
  toolName: 'write',
  toolArguments: JSON.stringify({ file_path: 'index.html', content: INDEX_HTML }),
  successText: 'done',
})
process.env.DEEPSEEK_API_KEY = 'hosted-generate-poc'
process.env.DEEPSEEK_BASE_URL = mock.baseURL
process.env.DSH_HOSTED_GENERATE_PORT ??= '3081'

const { ctx, home } = await loadHostedGenerate()
const port = ctx.webServer.port
const origin = `http://127.0.0.1:${String(port)}`

process.stdout.write(`hosted-generate: ${origin}/generate\n`)
process.stdout.write(`curl -sS -X POST ${origin}/generate -H 'content-type: application/json' -d '{"prompt":"a one-page hello site"}'\n`)
process.stdout.write('then GET /sessions/<id> until status is completed, then GET /sessions/<id>/artifact\n')

const shutdown = async (): Promise<void> => {
  await ctx.fiber.dispose()
  await mock.close()
  await rm(home, { recursive: true, force: true })
}

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})
process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})
