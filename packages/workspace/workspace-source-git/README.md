---
description: "Git provider for ctx.workspaceSource: clone, fetch, status, commit, push, pull, and branch checkout without storing tokens."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-source-git

English | [中文](README.zh.md)

## Summary

This provider registers `kind: 'git'` on `ctx.workspaceSource`. `resolve` fills owner, repo, branch, and `checkoutPath` under `checkoutParent/${owner}-${repo}` from a GitHub URL (or explicit owner/repo). `prepare` clones when the destination has no `.git`, otherwise fetches, checks out the recorded branch, and fast-forward pulls. Status, commit, push, pull, and branch checkout are on `ctx.workspaceSource.git()`. Specs never store tokens.

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
- name: '@deepseek-ai/dsh-workspace-source-git'
```

`workspace.createGit({ remoteUrl, checkoutParent, ... })` then clones or fetches before writing the workspace record.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is a Cordis `Service` that registers one git provider. Clone uses the `git` binary with no embedded credentials. `credentialId` is recorded and unused.

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

- Only GitHub URL parsing is built in; other remotes require explicit `owner` and `repo`.
- `credentialId` is unused; Git uses the process environment.
- Pull is fast-forward only.
- Source-control UI and git RPCs are later phases.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
