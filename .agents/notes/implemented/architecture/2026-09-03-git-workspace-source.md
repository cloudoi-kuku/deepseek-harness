# Agent Note: Git workspace source seam

Status: implemented

English | [中文](2026-09-03-git-workspace-source.zh.md)

## Problem

Hosted DeepSeek Harness (CoreNet overlay, later a public web IDE) needs a workspace that is a Git checkout, not a laptop folder. The registry today stores `{ path, title, sessionIds }` and `workspace.create({ path })` requires an existing directory. The overlay clones `cloudoi-harness` itself and then pins that path — that must keep working. A public product cannot keep encoding “one hosted dsh web with `/workspace` mapped to Git”; it needs a Git origin on the workspace record, checkout preparation before `session.create`, and no long-lived tokens in the durable record. Auth, per-user isolation, Git UX, IDE surfaces, and quotas are separate later problems.

## Decision

The workspace family grows a workspace-source capability seam. `ctx.workspaceSource` is the Service Definition: providers register by `kind` and implement `resolve(request) → spec` then `prepare(spec) → { cwd }`. `dsh-workspace-source-local` handles existing directories; `dsh-workspace-source-git` clones/fetches, checks out a branch, reports dirty/conflict status, and can commit/push/pull. Specs never store tokens; an optional `credentialId` names a credentials-seam record for a later lookup.

Durable workspace records are domain version 3 and require `source`:

```ts
{ kind: 'local', path }
{ kind: 'git', provider: 'github' | 'generic', owner, repo, branch, remoteUrl, checkoutPath, credentialId? }
```

`workspace.create({ path })` stays the local path. `workspace.createGit({ remoteUrl, checkoutParent, ... })` is the sibling. `session.create({ workspaceId })` calls `prepare(workspace.source)` when the seam is mounted and uses that cwd; without the seam, local records still use `workspace.path` so a CoreNet overlay that only calls `workspace.create({ path })` keeps working. A git record without the seam fails loud (`workspace-source-unavailable`).

The `dsh-web-app` bundle mounts the definition plus both providers. Product auth, per-user isolation, Git Host RPC, quotas, and remaining IDE surfaces are [the hosted principal slice](2026-09-03-hosted-principal-isolation.md).

## Alternatives considered

- **Keep Git only in the hosted overlay, leave OSS workspaces as `{ path }`.** Rejected because the public architecture would stay “one hosted dsh with `/workspace` mapped to Git,” and the OSS registry could not name a git origin or prepare a checkout before session create.
- **Replace `create({ path })` with a union request.** Rejected for this slice: the CoreNet overlay and every local directory picker call `workspace.create({ path })`. A sibling `createGit` is additive.
- **Store GitHub tokens on the workspace record.** Rejected: tokens are credentials-seam data. The record may hold `credentialId` only.
- **Prepare checkouts only at `createGit`, skip `session.create`.** Rejected: a later session on a disposable cache must fetch/fast-forward before the agent loop sees cwd.
- **Change `agent-loop` to understand Git workspaces.** Rejected: the loop continues to receive a resolved local cwd.

## Consequences

Compositions that mount `ctx.workspaceSource` clone or fetch on git `session.create` and `createGit`. Compositions that do not mount it keep the previous local-path behavior, which is the CoreNet overlay contract. Domain version 4 adds optional `owner` and rejects on-disk version 3 workspace units (`version-mismatch`); this repo has no external consumers. Git operations exist on the seam and as Host RPC (`workspace.git*`); source-control UI is later. `credentialId` is unused until a later credentials wiring. Per-user checkout roots, product principal, and quotas are [the hosted principal slice](2026-09-03-hosted-principal-isolation.md). Container isolation and IDE surfaces remain later work.
