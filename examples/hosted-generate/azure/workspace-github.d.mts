// Declarations for workspace-github.mjs — see the note in launch-token.d.mts.

export interface WorkspaceGrant {
  kind: 'github'
  owner: string
  name: string
  token: string
  cloneUrl: string
  defaultBranch: string
  brief: string
}

export declare const WORKSPACE_DIR: string

/** Validates an untrusted grant body. Null rather than throwing, so a malformed grant is a rejection. */
export declare function parseWorkspaceGrant(body: unknown): WorkspaceGrant | null

export declare function githubHttpsOrigin(owner: string, name: string): string

export declare function fetchWorkspaceGrant(
  launchToken: string,
  opts?: { fetchImpl?: typeof fetch; origin?: string },
): Promise<WorkspaceGrant>

export declare function ensureGithubWorkspace(launchToken: string): Promise<unknown>

export declare function dshRpc(
  method: string,
  payload: unknown,
  opts?: { origin?: string; fetchImpl?: typeof fetch; rpcId?: string },
): Promise<unknown>

export declare function adoptDshWorkspace(opts?: {
  path?: string
  title?: string
  origin?: string
  fetchImpl?: typeof fetch
  attempts?: number
  delayMs?: number
  sleep?: (ms: number) => Promise<void>
  rpc?: typeof dshRpc
}): Promise<{ workspaceId: string; path: string; title: string }>

/** Masks a secret for logging. The GitHub token passes through these modules. */
export declare function redact(value: string): string
