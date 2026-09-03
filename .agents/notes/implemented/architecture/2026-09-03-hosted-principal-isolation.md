# Agent Note: Hosted principal, checkout isolation, Git RPC, and quotas

Status: implemented

English | [中文](2026-09-03-hosted-principal-isolation.zh.md)

## Problem

Items 5–10 of the public Git web IDE architecture (product auth, per-user isolation, Git sync Host APIs, IDE surfaces, durable grants/audit, quotas) sat on top of the [git workspace-source seam](2026-09-03-git-workspace-source.md) with no caller identity. Same-process Host RPC had no request-scoped tenant/user, `createGit` trusted a client `checkoutParent`, git status/commit/push/pull existed only on the seam, and there was no kill switch or per-user cap. The CoreNet overlay HMAC cookie (`harness_launch`, claims `tid,uid,product,exp`) and `workspace.create({ path })` pin must keep working. OSS `dsh web` must stay an unauthenticated directory picker.

## Decision

`ctx.principal` (`dsh-principal`) is an optional Service Definition: authenticators register by id, `bindFromRequest` identifies, and `run` binds the caller on `AsyncLocalStorage` for one Host request. Default `dsh web` does not mount it. `dsh-principal-hmac` re-validates the CoreNet launch token (cookie `harness_launch` or `Authorization: Bearer`) inside dsh; the overlay proxy keeps its own HMAC in `examples/hosted-generate/azure/launch-token.mjs` and is not rewritten. `auth.me` / `auth.logout` are Host RPC. Logout emits `Set-Cookie` Max-Age=0; expiry is `exp`; there is no revocation list in this slice.

When authenticators are registered, workspace records stamp optional `owner: { tenantId, userId }` (domain version 4). Host RPC uses `listVisible` / `getVisible`: another tenant's id looks like not-found. OSS (no authenticators) still lists every record and `create({ path })` is unchanged.

Authenticated `createGit` ignores client `checkoutParent` and checks out under `hostedLimits.checkoutRoot/<tenantId>/<userId>/<owner>-<repo>`. Without authenticators, `checkoutParent` remains required. Container isolation is not in this slice.

`workspace.gitStatus` / `gitCommit` / `gitPush` / `gitPull` / `gitCheckoutBranch` are Host RPC over the existing git provider. `dsh-hosted-limits` supplies `killSwitch`, per-user workspace and live-session caps (`0` = unlimited), a process-local git-op rate limit, and `checkoutRoot`. Unmounted compositions have no quotas.

Durable persistence: workspace owner is on the record; session logs, settings, and credentials stay on their existing seams; git checkouts remain disposable. Dedicated audit and GitHub-grant tables are not in this slice; quota/auth rejections are Host RPC errors. File tree, editor tabs, diff, terminal, preview, search, and SCM UI remain later IDE work. Agent-loop is unchanged: it still receives a resolved local cwd.

## Alternatives considered

- **Trust overlay-forwarded `tid`/`uid` headers inside dsh.** Rejected: the Host re-validates HMAC so a misconfigured proxy cannot mint identity.
- **Require principal in default `dsh web`.** Rejected: OSS is a local directory picker; authenticators are a hosted patch.
- **Honor client `checkoutParent` when a principal is bound.** Rejected: that escapes per-user checkout roots.
- **Return `forbidden` for another tenant's workspace id.** Rejected for this slice: `getVisible` returns `undefined` so Host RPC stays `workspace-not-found` and does not confirm the id exists.
- **Shared durable audit domain in this slice.** Rejected: owner-on-record plus Host error codes are the first durable/observable records; a dedicated audit table can wait.

## Consequences

Hosted patches that mount `principal` + `principal-hmac` + `hosted-limits` isolate git checkouts and filter workspace RPC by owner. Compositions that do not mount them keep Phase 1 local-path behavior, including the CoreNet `create({ path })` pin. Domain version 4 rejects on-disk version 3 workspace units. GitHub OAuth, server-side revocation, container isolation, dedicated audit/grants, and IDE surfaces remain later work.
