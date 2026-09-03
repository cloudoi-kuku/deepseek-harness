# @deepseek-ai/dsh-workspace-source-local

English | [中文](README.zh.md)

Local-directory provider for `ctx.workspaceSource` (`kind: 'local'`). Canonicalizes an existing directory through `fs.realpath`; `prepare` is that same check. A missing or non-directory path throws `WORKSPACE_SOURCE_INVALID_REQUEST`.

## Model Experience

### Request context and condition

#### What the model sees

Nothing. This provider registers into `ctx.workspaceSource` and contributes no tools, prompts, or session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

- The provider does not create directories; `workspace.create({ path })` still requires an existing path, matching the registry.
