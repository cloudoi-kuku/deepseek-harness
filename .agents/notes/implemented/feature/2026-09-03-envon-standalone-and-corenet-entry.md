# Agent Note: Envon standalone Git IDE beside CoreNet login

Status: implemented

English | [中文](2026-09-03-envon-standalone-and-corenet-entry.zh.md)

## Problem

The public Git web IDE (git workspace-source, `createGit`, Host git RPC, optional principal isolation) is meant to run as DeepSeek Harness at `harness.cloudoi.io` without every visitor passing through CoreNet. The Envon overlay still needs CoreNet HMAC launch (`tid,uid,product,exp` on `/?launch=` and cookie `harness_launch`) so a CloudOI account can pin its GitHub grant via `workspace.create({ path })`. Unauthenticated GET `/` 302'd to `HARNESS_CORENET_ORIGIN/app/harness-launch` whenever that origin was set, so GENERATE_TOKEN never presented a browser Git IDE and `createGit` was unreachable without app.cloudoi.io.

## Decision

`packages/experimental/hosted-generate/example/azure/web-proxy.mjs` keeps HMAC `/?launch=` pin, cookie, and `/workspace` `workspace.create`. Unauthenticated HTML GET `/` returns a landing that offers CloudOI login and, when `GENERATE_TOKEN` is set or launch HMAC is unset, the Git IDE (`/`) plus `/clone`. Non-HTML unauthenticated requests still 401 with Basic/Bearer. GENERATE_TOKEN GET `/` forwards to loopback `dsh web` and does not pin `/workspace`. Authorized `POST /clone` `{ remoteUrl }` (JSON or form) calls dsh `workspace/createGit` with `checkoutParent=/workspace` (no principal-hmac on the live composition). `/new` still 302s to `/`. Default web still does not mount `principal-hmac`.

Grok persona in `grok.patch.yml` follows `.cloudoi/CORENET.md`: CoreNet publish/database commands only when that file exists.

## Alternatives considered

**Keep the unauthenticated 302 to CoreNet.** Rejected: it made GENERATE_TOKEN and `createGit` unreachable from a browser at `harness.cloudoi.io`.

**Mount `principal-hmac` on live Envon so standalone `createGit` omits `checkoutParent`.** Rejected for this slice: GENERATE_TOKEN has no launch cookie, so `listVisible` would be empty.

**GitHub OAuth on harness.cloudoi.io.** Deferred. GENERATE_TOKEN is the standalone gate until product OAuth exists.

## Consequences

A CloudOI user still opens Envon through `app.cloudoi.io` (`/?launch=`). Visiting `https://harness.cloudoi.io/` without a launch cookie shows the landing instead of bouncing to CoreNet. Operators with GENERATE_TOKEN reach `dsh web` and can clone a public GitHub https URL. Isolation is still one process; CoreNet and GENERATE_TOKEN share the replica. Private clones without a CoreNet grant remain later work.

## Testing

`packages/experimental/hosted-generate/tests/web-proxy.spec.ts` covers HTML landing without a CoreNet `Location`, JSON 401 without a `Location`, and GENERATE_TOKEN forwarding without a pin. `workspace-github.spec.ts` covers `parseGithubHttpsRemote` (no credentials in the URL) and `workspace/createGit` args `{ request: { remoteUrl, checkoutParent } }`.

## Related

[Envon GitHub cwd](2026-08-29-envon-github-cwd.md) still owns HMAC clone-into-`/workspace` and `/new` → `/`. [Hosted generate POC](2026-08-28-hosted-generate-poc.md) still owns generate occupancy. [Hosted principal isolation](../architecture/2026-09-03-hosted-principal-isolation.md) still owns why live Envon does not mount `principal-hmac`.
