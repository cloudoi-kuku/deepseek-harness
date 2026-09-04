---
description: "Local directory provider for ctx.workspaceSource: prepare an existing host path as the session cwd."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-source-local

English | [中文](README.zh.md)

## Summary

This provider registers `kind: 'local'` on `ctx.workspaceSource`. `resolve` records the requested path; `prepare` canonicalizes it with `fs.realpath` and requires an existing directory. `workspace.create({ path })` still requires the directory to exist.

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

Mount after `dsh-workspace-source`. There is no configuration.

```yaml
- name: '@deepseek-ai/dsh-workspace-source'
- name: '@deepseek-ai/dsh-workspace-source-local'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is a Cordis `Service` that only registers the local provider into `ctx.workspaceSource`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-workspace-source`](../workspace-source/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

Nothing. This provider registers into `ctx.workspaceSource` and contributes no tools, prompts, or session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The provider does not create directories.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
