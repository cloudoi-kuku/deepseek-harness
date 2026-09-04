# Agent Note: Git workspace sources prepare local checkouts

Status: implemented

English | [中文](2026-09-03-git-workspace-source.zh.md)

## Problem

Web hosts need to open a user's project from Git without giving the browser or model direct filesystem authority over the host. The existing workspace registry treated an already-present local directory as both the acquisition method and the session cwd, so a public IDE would have to clone repositories in product-specific bootstrap code and then disguise every checkout as a local workspace.

That bootstrap-only design leaves no durable owner for the repository URL, branch, checkout path, or credential reference. Session creation can resume the stored cwd, but it cannot refresh the checkout or reject a Git workspace when the source provider is absent.

## Decision

The workspace subsystem stores a `source` record beside each workspace's canonical `path`. Local records name an existing host directory. Git records name the provider, owner, repo, branch, remote URL, checkout path, and optional `credentialId`; the durable record never stores a token.

`ctx.workspaceSource` is the provider registry for workspace acquisition. `resolve` fills a durable source spec without network or filesystem effects, and `prepare` performs the I/O that returns the canonical cwd sessions use. `dsh-workspace-source-local` prepares existing directories, and `dsh-workspace-source-git` clones or fetches GitHub repositories through the process Git environment.

`workspaceRegistry.createGit` resolves and prepares the Git source before writing a workspace record, then reuses any existing workspace whose canonical cwd matches the checkout. `session.create({ workspaceId })` prepares the stored source before agent creation when `ctx.workspaceSource` is mounted; without that service, local records use their stored path and Git records reject.

The web-app bundle mounts the dispatcher plus local and Git providers so browser clients can call `workspace.createGit` through the Workspace Remote namespace. The client service and model expose the same verb as `createGit`, while the workspace feed carries the stored source projection.

## Testing

Focused tests cover provider dispatch, local canonicalization, Git URL parsing, clone/fetch/status operations, `workspaceRegistry.createGit`, Remote idempotence, client projection, test-runtime fakes, and session creation from a workspace source. The branch also passes `pnpm run typecheck`, `pnpm run test:docs`, and the focused workspace/session Vitest set used for this change.

## Alternatives considered

**Make Git replace the workspace registry.** A Git-only registry would make the public web case direct, but it would break local directory workspaces and force every existing workspace consumer to understand repository metadata. Keeping Git as a source preserves the stable workspace id and cwd model.

**Keep repository cloning in product bootstrap scripts.** This matches the hosted-generate proof of concept, but the core registry only sees `/workspace`, so it cannot remember origin, branch, or credential identity. Moving origin data into `WorkspaceRecord.source` gives session creation and browser APIs an owned Git path.

**Store Git tokens on workspace records.** A durable token would make clone independent of the process environment, but it would put credentials in the workspace table and session-adjacent projections. The record stores `credentialId` only; credential lookup and Git environment setup remain provider or host responsibilities.

## Consequences

The agent loop, filesystem tools, shells, and LSP providers still receive an ordinary local cwd, so Git-backed workspaces do not require a remote filesystem rewrite. A public web IDE can map a user's GitHub repository to an isolated checkout parent and open sessions by workspace id.

Checkout isolation, credential materialization, and tenant policy remain host responsibilities around the provider. Source-control status, commit, push, pull, and branch checkout are provider operations; a UI or Remote controller can wrap them without changing workspace creation.
