# @deepseek-ai/dsh-workspace-source

English | [中文](README.zh.md)

Workspace origin capability (`ctx.workspaceSource`) for the DeepSeek Harness: a kind-keyed registry that canonicalizes checkout requests and materializes a local cwd. Local directories and Git remotes register as providers; consumers never import provider packages. Durable specs never store tokens. Decision record: [git workspace-source Agent Note](../../../.agents/notes/implemented/architecture/2026-09-03-git-workspace-source.md).

## Shape

- `ctx.workspaceSource.register(provider)` — registers one `kind`. A duplicate kind throws `WORKSPACE_SOURCE_DUPLICATE_KIND`. The disposer unregisters on fiber disposal.
- `resolve(request)` — dispatches on `request.kind` and returns a durable spec (`local` path or `git` remote identity plus `checkoutPath`).
- `prepare(spec)` — materializes or refreshes the working copy and returns `{ cwd, spec }` for `SessionHeader.cwd`.
- `status` / `commit` / `push` / `pull` / `checkoutBranch` — git-only operations; a missing git provider or a non-git spec throws `WORKSPACE_SOURCE_UNKNOWN_KIND` or `WORKSPACE_SOURCE_NOT_GIT`.

An unregistered kind fails at the call, not at load.

## Model Experience

### Request context and condition

#### What the model sees

Nothing. `ctx.workspaceSource` serves host-side checkout preparation only: the package registers no tools, injects no prompts, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

- Git credential lookup from `credentialId` is stored on the spec and unused; clone uses the process Git environment.
- Host RPC for status/commit/push/pull/branch is on `workspace.git*` in `dsh-host-apiproxy`; source-control UI is later.
