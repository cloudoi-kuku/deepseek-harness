# @deepseek-ai/dsh-workspace-source-git

English | [中文](README.zh.md)

Git checkout provider for `ctx.workspaceSource` (`kind: 'git'`). `resolve` parses a clone URL into `{ provider, owner, repo, branch, remoteUrl, checkoutPath }` under `checkoutParent/${owner}-${repo}` and never stores a token. `prepare` clones when the destination is missing, otherwise fetches, checks out the recorded branch, and fast-forward pulls. Status, commit, push, pull, and branch checkout are available on `ctx.workspaceSource`.

Config: `operationTimeoutMs` (default `120000`) caps clone/fetch/push/pull.

## Model Experience

### Request context and condition

#### What the model sees

Nothing. This provider registers into `ctx.workspaceSource` and contributes no tools, prompts, or session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

- `credentialId` is recorded on the spec and unused; Git uses the process environment (`GIT_TERMINAL_PROMPT=0`).
- Pull is fast-forward only. A diverged upstream fails `prepare` rather than merging.
- Source-control UI is later; Host RPC is `workspace.gitStatus` / `gitCommit` / `gitPush` / `gitPull` / `gitCheckoutBranch`.
