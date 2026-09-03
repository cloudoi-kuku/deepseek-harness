/**
 * Hosted generate service: one disposable workspace per session, file-map
 * artifacts, optional loopback HTTP. It does not deploy, write DNS, or hold
 * product credentials.
 *
 * @module @deepseek-ai/dsh-experimental-hosted-generate
 */

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { artifactLimits, collectArtifact } from './artifact.ts'
import { HostedGenerateError } from './error.ts'
import { mountGenerateRoutes } from './http.ts'
import { GenerateSessionId } from './types.ts'
import type {
  Config,
  GenerateArtifact,
  GenerateStartRequest,
  GenerateStatus,
  GenerateStatusKind,
} from './types.ts'
import { createWorkspace, wipeWorkspace } from './workspace.ts'

export type * from './types.ts'
export { GenerateSessionId } from './types.ts'
export { HostedGenerateError } from './error.ts'
export { collectArtifact, artifactLimits } from './artifact.ts'
export { createWorkspace, wipeWorkspace } from './workspace.ts'
export { mountGenerateRoutes, readJsonBody } from './http.ts'
export type { GenerateHttpHost } from './http.ts'

const DEFAULT_TASK_GUIDANCE = [
  'Generate a static website or small app in this workspace.',
  'Write UTF-8 files under the workspace root.',
  'Do not deploy, do not use network services, and do not read files outside the workspace.',
  'Stop when the files are ready.',
].join(' ')

declare module '@deepseek-ai/cordis' {
  interface Context {
    hostedGenerate: HostedGenerateService
  }
}

/** Test-substitutable stdout used when `printListen` is true. */
export const internals: { stdout: { write(chunk: string): unknown } } = {
  stdout: process.stdout,
}

interface LiveRecord {
  status: GenerateStatus
  artifact: GenerateArtifact | undefined
  handle: AgentHandle | undefined
  workspaceRoot: string | undefined
}

/** Hosted generate service (`ctx.hostedGenerate`). */
export default class HostedGenerateService extends Service {
  static inject = ['agents', 'sessions']

  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
    maxConcurrentSessions: z.number().step(1).min(1).default(1),
    sessionTimeoutMs: z.number().step(1).min(1).default(30_000),
    maxSteps: z.number().step(1).min(1).default(6),
    maxArtifactBytes: z.number().step(1).min(1).default(262_144),
    maxFiles: z.number().step(1).min(1).default(16),
    maxFileBytes: z.number().step(1).min(1).default(65_536),
    maxPromptBytes: z.number().step(1).min(1).default(16_384),
    maxRetainedSessions: z.number().step(1).min(1).default(8),
    workspaceParent: z.string().default(tmpdir()),
    taskGuidance: z.string().default(DEFAULT_TASK_GUIDANCE),
    authToken: z.string().default(''),
    printListen: z.boolean().default(false),
  })

  /** Validated deployment limits and model route. */
  private readonly config: Required<Config>
  private readonly records = new Map<GenerateSessionId, LiveRecord>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'hostedGenerate')
    this.config = config as Required<Config>
    this.ctx.effect(() => () => {
      void this.shutdown()
    })
    this.ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.section({
        name: 'app:hosted-generate',
        order: -50,
        text: this.config.taskGuidance,
      })
    })
    this.ctx.inject(['webServer'], (httpCtx) => {
      const disposeRoutes = mountGenerateRoutes(
        httpCtx.webServer,
        this,
        this.config.authToken,
        this.config.maxPromptBytes,
      )
      if (this.config.printListen) {
        internals.stdout.write(`hosted-generate: http://127.0.0.1:${String(httpCtx.webServer.port)}/generate\n`)
      }
      return disposeRoutes
    })
  }

  /**
   * Start one generation in a disposable workspace.
   * @param request - user prompt and optional tenant correlation.
   * @returns the generation id; poll {@link status} until it is terminal.
   */
  async start(request: GenerateStartRequest): Promise<{ sessionId: GenerateSessionId }> {
    this.assertPrompt(request.prompt)
    if (this.runningCount() >= this.config.maxConcurrentSessions) {
      throw new HostedGenerateError('GENERATE_BUSY', 'a generation is already running')
    }
    const sessionId = GenerateSessionId(`generate-${randomUUID()}`)
    const workspaceRoot = await createWorkspace(this.config.workspaceParent)
    const record: LiveRecord = {
      status: {
        sessionId,
        ...request.tenantId === undefined ? {} : { tenantId: request.tenantId },
        status: 'running',
      },
      artifact: undefined,
      handle: undefined,
      workspaceRoot,
    }
    this.records.set(sessionId, record)
    try {
      record.handle = await this.ctx.agents.create({
        sessionId: SessionId(sessionId),
        meta: { cwd: workspaceRoot },
        agentOptions: { provider: this.config.provider, model: this.config.model },
      })
    } catch (error: unknown) {
      await wipeWorkspace(workspaceRoot)
      this.records.delete(sessionId)
      throw new HostedGenerateError(
        'GENERATE_FAILED',
        /* v8 ignore next -- Agent factory rejections are Error instances. */
        error instanceof Error ? error.message : String(error),
      )
    }
    void this.run(record, request.prompt)
    return { sessionId }
  }

  /**
   * Read one generation's public status.
   * @param sessionId - id returned by {@link start}.
   * @returns the current status record.
   */
  status(sessionId: GenerateSessionId): GenerateStatus {
    return { ...this.require(sessionId).status }
  }

  /**
   * Read the collected file map of a completed generation.
   * @param sessionId - id returned by {@link start}.
   * @returns the artifact.
   */
  artifact(sessionId: GenerateSessionId): GenerateArtifact {
    const record = this.require(sessionId)
    if (record.status.status !== 'completed' || record.artifact === undefined) {
      throw new HostedGenerateError('GENERATE_NOT_FOUND', 'artifact is not available')
    }
    return { sessionId: record.artifact.sessionId, files: { ...record.artifact.files } }
  }

  /** Count generations still running. */
  private runningCount(): number {
    let count = 0
    for (const record of this.records.values()) {
      if (record.status.status === 'running') count += 1
    }
    return count
  }

  /** Reject an empty or oversized prompt. */
  private assertPrompt(prompt: string): void {
    if (prompt.trim() === '') {
      throw new HostedGenerateError('GENERATE_INVALID_REQUEST', 'prompt must be non-empty')
    }
    if (Buffer.byteLength(prompt, 'utf8') > this.config.maxPromptBytes) {
      throw new HostedGenerateError('GENERATE_INVALID_REQUEST', 'prompt exceeds maxPromptBytes')
    }
  }

  /** Look up a generation or throw {@link HostedGenerateError}. */
  private require(sessionId: GenerateSessionId): LiveRecord {
    const record = this.records.get(sessionId)
    if (record === undefined) {
      throw new HostedGenerateError('GENERATE_NOT_FOUND', 'generation session does not exist')
    }
    return record
  }

  /** Drive the Agent to quiescence, collect files, then wipe the workspace. */
  private async run(record: LiveRecord, prompt: string): Promise<void> {
    const handle = record.handle
    const workspaceRoot = record.workspaceRoot
    /* v8 ignore next -- start() always records a handle and workspace before run(). */
    if (handle === undefined || workspaceRoot === undefined) return
    const { agent } = handle
    const stopSteps = agent.ctx.on('session/event', (session, event) => {
      if (event.type !== 'step/end') return
      const steps = session.events.filter(item => item.type === 'step/end').length
      if (steps >= this.config.maxSteps) {
        agent.cancel({ kind: 'hook', reason: 'hosted-generate-max-steps' })
      }
    })
    let outcome: GenerateStatusKind = 'completed'
    let error: GenerateStatus['error']
    try {
      await agent.whenIdle()
      const text = this.config.taskGuidance === ''
        ? prompt
        : `${this.config.taskGuidance}\n\nUser request:\n${prompt}`
      agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
      const idle = agent.whenIdle()
      const timedOut = await this.raceIdle(idle, this.config.sessionTimeoutMs)
      if (timedOut) {
        agent.cancel({ kind: 'hook', reason: 'hosted-generate-timeout' })
        await agent.whenIdle()
        outcome = 'cancelled'
        error = { code: 'GENERATE_TIMEOUT', message: 'generation exceeded sessionTimeoutMs' }
      } else {
        let reason: TurnEndReason | undefined
        for (const event of agent.session.events) {
          if (event.type === 'turn/end') reason = event.data.reason
        }
        if (reason?.kind === 'aborted') {
          outcome = 'cancelled'
          error = { code: 'GENERATE_FAILED', message: 'generation was cancelled' }
        } else if (reason?.kind === 'error') {
          outcome = 'failed'
          error = { code: 'GENERATE_FAILED', message: reason.error.message }
        }
      }
    } catch (caught: unknown) {
      /* v8 ignore start -- the loop reports turn/end error rather than throwing into run(). */
      outcome = 'failed'
      error = {
        code: 'GENERATE_FAILED',
        message: caught instanceof Error ? caught.message : String(caught),
      }
      /* v8 ignore stop */
    } finally {
      stopSteps()
    }

    const stepCount = agent.session.events.filter(event => event.type === 'step/end').length
    let files: Record<string, string> = {}
    if (outcome === 'completed') {
      try {
        files = await collectArtifact(workspaceRoot, artifactLimits(this.config))
      } catch (caught: unknown) {
        outcome = 'failed'
        if (caught instanceof HostedGenerateError) {
          error = { code: caught.code, message: caught.message }
        /* v8 ignore start -- collectArtifact throws HostedGenerateError. */
        } else {
          error = {
            code: 'GENERATE_FAILED',
            message: caught instanceof Error ? caught.message : String(caught),
          }
        }
        /* v8 ignore stop */
      }
    }

    await handle.dispose()
    await wipeWorkspace(workspaceRoot)
    record.handle = undefined
    record.workspaceRoot = undefined
    record.status = {
      ...record.status,
      status: outcome,
      stepCount,
      ...error === undefined ? {} : { error },
      ...outcome === 'completed'
        ? { fileCount: Object.keys(files).length, byteCount: utf8Size(files) }
        : {},
    }
    if (outcome === 'completed') {
      record.artifact = { sessionId: record.status.sessionId, files }
    }
    this.pruneRetained()
  }

  /** Wait for idle or the timeout, whichever happens first. */
  private async raceIdle(idle: Promise<void>, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => { resolve(true) }, timeoutMs)
    })
    try {
      const timedOut = await Promise.race([idle.then(() => false), timeout])
      return timedOut
    } finally {
      clearTimeout(timer)
    }
  }

  /** Drop oldest terminal records when retention is full. */
  private pruneRetained(): void {
    const terminal = [...this.records.entries()].filter(([, record]) => record.status.status !== 'running')
    const overflow = terminal.length - this.config.maxRetainedSessions
    if (overflow <= 0) return
    for (const [id] of terminal.slice(0, overflow)) this.records.delete(id)
  }

  /** Cancel live Agents and wipe remaining workspaces. */
  private async shutdown(): Promise<void> {
    const live = [...this.records.values()]
    this.records.clear()
    for (const record of live) {
      try {
        record.handle?.agent.cancel({ kind: 'disposed' })
        if (record.handle !== undefined) await record.handle.dispose()
      } catch {
        /* v8 ignore next -- disposal races with an in-flight run that already disposed the handle. */
      }
      if (record.workspaceRoot !== undefined) await wipeWorkspace(record.workspaceRoot)
    }
  }
}

/** Sum UTF-8 sizes of every file in an artifact map. */
function utf8Size(files: Record<string, string>): number {
  let total = 0
  for (const content of Object.values(files)) total += Buffer.byteLength(content, 'utf8')
  return total
}
