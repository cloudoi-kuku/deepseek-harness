---
description: "Workspace origin seam (ctx.workspaceSource): resolve a local or Git request to a durable spec and prepare the session cwd, without storing tokens."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-source

English | [中文](README.zh.md)

## Summary

`dsh-workspace-source` (`ctx.workspaceSource`) is the host-side origin seam for workspaces: providers register by `kind`, `resolve` fills a durable spec, and `prepare` materializes a local cwd for `session.create`. Local directories and Git remotes are separate providers. Specs never store tokens; an optional `credentialId` names a credentials-store record. The agent loop still receives a resolved local directory.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load the service, then mount `dsh-workspace-source-local` and/or `dsh-workspace-source-git`. `workspaceRegistry.create({ path })` stays the local path API. `createGit` requires the git provider.

```yaml
- name: '@deepseek-ai/dsh-workspace-source'
- name: '@deepseek-ai/dsh-workspace-source-local'
- name: '@deepseek-ai/dsh-workspace-source-git'
- name: '@deepseek-ai/dsh-workspace'
```

`session.create({ workspaceId })` calls `prepare(workspace.source)` when this service is mounted. Without it, local records still use `workspace.path`, so overlays that clone then `workspace.create({ path })` keep working.

### Failure handling

An unregistered kind throws at the call. Duplicate kinds throw at register. Git-only methods throw when no git provider is mounted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Registrations are effects: `register` returns a disposer and unregisters on fiber disposal. `resolve` must not clone or touch the network; `prepare` is the I/O step. The durable `WorkspaceRecord.source` field stores the spec.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Git workspace-source decision](../../../.agents/notes/implemented/architecture/2026-09-03-git-workspace-source.md)
- [Workspace subsystem](../../../docs/subsystems/workspace.md)

-----

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

Nothing. `ctx.workspaceSource` registers no tools, injects no prompts, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `credentialId` is stored on the spec and unused; clone uses the process Git environment.
- Git status/commit/push/pull have no Host RPC or UI in this slice.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
