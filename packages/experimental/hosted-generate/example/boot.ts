/** Boot the example `cordis.yml` through the vendored Loader with real plugins. */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import * as AgentSpine from '@deepseek-ai/dsh-agent-spine-demo'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import HostedGenerateService from '@deepseek-ai/dsh-experimental-hosted-generate'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'

const configPath = fileURLToPath(new URL('./cordis.yml', import.meta.url))

export interface LoadedGenerate {
  /** Live composition. */
  ctx: Context
  /** Disposable DSH_HOME. */
  home: string
}

/**
 * Load the example YAML. The caller owns `DEEPSEEK_*` and generate env vars
 * for the process lifetime of the test or demo.
 * @returns the live context and temp home.
 */
export async function loadHostedGenerate(): Promise<LoadedGenerate> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-hosted-generate-example-'))
  process.env.DSH_HOME = home
  process.env.DSH_HOSTED_GENERATE_PORT ??= '0'
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(home).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-llm-deepseek', LlmDeepSeek],
    ['@deepseek-ai/dsh-agent-spine-demo', AgentSpine],
    ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModelConfig],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-tool-fs', ToolFs],
    ['@deepseek-ai/dsh-experimental-hosted-generate', HostedGenerateService],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx, home }
}
