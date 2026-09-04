import { describe, expect, it } from 'vitest'
import {
  adoptDshWorkspace,
  dshRpc,
  fetchWorkspaceGrant,
  githubHttpsOrigin,
  parseWorkspaceGrant,
  redact,
} from '../azure/workspace-github.mjs'

describe('parseWorkspaceGrant', () => {
  it('accepts a github clone grant and rejects a missing token', () => {
    expect(
      parseWorkspaceGrant({
        kind: 'github',
        owner: 'ada',
        name: 'cloudoi-harness',
        cloneUrl: 'https://github.com/ada/cloudoi-harness.git',
        token: 'gho_secret',
        defaultBranch: 'main',
        brief: 'A booking site',
      }),
    ).toEqual({
      kind: 'github',
      owner: 'ada',
      name: 'cloudoi-harness',
      cloneUrl: 'https://github.com/ada/cloudoi-harness.git',
      token: 'gho_secret',
      defaultBranch: 'main',
      brief: 'A booking site',
    })
    expect(
      parseWorkspaceGrant({
        kind: 'github',
        owner: 'ada',
        name: 'cloudoi-harness',
        cloneUrl: 'https://github.com/ada/cloudoi-harness.git',
        token: '',
      }),
    ).toBeNull()
  })
})

describe('githubHttpsOrigin', () => {
  it('builds an https origin without embedding a token', () => {
    expect(githubHttpsOrigin('ada', 'cloudoi-harness')).toBe(
      'https://github.com/ada/cloudoi-harness.git',
    )
  })
})

describe('redact', () => {
  it('strips x-access-token secrets from git stderr', () => {
    expect(redact('fatal: https://x-access-token:gho_secret@github.com/ada/repo.git')).toBe(
      'fatal: https://x-access-token:***@github.com/ada/repo.git',
    )
  })
})

describe('fetchWorkspaceGrant', () => {
  it('sends the launch token as Bearer and parses the JSON grant', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('https://api.cloudoi.io/api/ai-build/from-harness/workspace')
      expect(init?.headers).toMatchObject({ authorization: 'Bearer launch-token' })
      return new Response(
        JSON.stringify({
          kind: 'github',
          owner: 'ada',
          name: 'cloudoi-harness',
          cloneUrl: 'https://github.com/ada/cloudoi-harness.git',
          token: 'gho_secret',
          defaultBranch: 'main',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const grant = await fetchWorkspaceGrant('launch-token', {
      fetchImpl,
      origin: 'https://api.cloudoi.io',
    })
    expect(grant.owner).toBe('ada')
    expect(grant.token).toBe('gho_secret')
  })

  it('maps CoreNet 400 to a GitHub-connected-account error', async () => {
    const fetchImpl: typeof fetch = async () => new Response('{}', { status: 400 })
    await expect(
      fetchWorkspaceGrant('launch-token', { fetchImpl, origin: 'https://api.cloudoi.io' }),
    ).rejects.toThrow(/GitHub must be connected/)
  })
})

describe('dshRpc', () => {
  it('POSTs a published-dsh apiproxy envelope to /api/<dotted-method>', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:3080/api/workspace.create')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toMatchObject({ 'content-type': 'application/json' })
      const body = JSON.parse(String(init?.body)) as {
        type: string
        method: string
        payload: { path: string }
      }
      expect(body).toMatchObject({
        type: 'client-request',
        method: 'workspace.create',
        payload: { path: '/workspace' },
      })
      return new Response(
        JSON.stringify({
          type: 'server-response',
          rpcId: body.method,
          result: { ok: true, value: { created: true, workspace: { workspaceId: 'ws-1' } } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const value = await dshRpc(
      'workspace.create',
      { path: '/workspace' },
      { origin: 'http://127.0.0.1:3080', fetchImpl, rpcId: 't1' },
    )
    expect(value).toEqual({ created: true, workspace: { workspaceId: 'ws-1' } })
  })
})

describe('adoptDshWorkspace', () => {
  it('creates /workspace then renames it to owner/name', async () => {
    const calls: string[] = []
    const rpc = async (method: string, args: Record<string, unknown>) => {
      calls.push(method)
      if (method === 'workspace.create') {
        expect(args).toEqual({ path: '/workspace' })
        return {
          created: true,
          workspace: { workspaceId: 'ws-1', path: '/workspace', title: 'workspace' },
        }
      }
      expect(method).toBe('workspace.rename')
      expect(args).toEqual({ workspaceId: 'ws-1', title: 'ada/cloudoi-harness' })
      return { workspace: { workspaceId: 'ws-1', path: '/workspace', title: 'ada/cloudoi-harness' } }
    }

    const workspace = await adoptDshWorkspace({
      path: '/workspace',
      title: 'ada/cloudoi-harness',
      rpc: rpc as typeof dshRpc,
    })
    expect(calls).toEqual(['workspace.create', 'workspace.rename'])
    expect(workspace.workspaceId).toBe('ws-1')
  })

  it('retries create until dsh web is listening, then fails loud on a business RPC error', async () => {
    let creates = 0
    const delays: number[] = []
    const rpc = async (method: string) => {
      if (method !== 'workspace.create') throw new Error(`unexpected ${method}`)
      creates += 1
      if (creates === 1) {
        const error = new Error('dsh workspace.create HTTP 404')
        ;(error as Error & { status: number }).status = 404
        throw error
      }
      return {
        created: true,
        workspace: { workspaceId: 'ws-2', path: '/workspace', title: 'workspace' },
      }
    }

    await expect(
      adoptDshWorkspace({
        path: '/workspace',
        attempts: 3,
        delayMs: 5,
        sleep: async (ms) => { delays.push(ms) },
        rpc: rpc as typeof dshRpc,
      }),
    ).resolves.toMatchObject({ workspaceId: 'ws-2' })
    expect(creates).toBe(2)
    expect(delays).toEqual([5])

    const invalid = async () => {
      const error = new Error('invalid payload for workspace.create')
      ;(error as Error & { code: string }).code = 'bad-request'
      throw error
    }
    await expect(
      adoptDshWorkspace({ attempts: 5, rpc: invalid as typeof dshRpc }),
    ).rejects.toThrow(/invalid payload for workspace.create/)
  })
})
