# @deepseek-ai/dsh-hosted-limits

English | [中文](README.zh.md)

Hosted multi-tenant policy (`ctx.hostedLimits`) for DeepSeek Harness: a deployment kill switch, per-user workspace and live-session caps, a process-local git-op rate limit, and the absolute `checkoutRoot` used to isolate git working copies as `checkoutRoot/<tenantId>/<userId>/<owner>-<repo>`. Numeric caps treat `0` as unlimited. Default `dsh web` does not mount this service. Decision record: [hosted principal Agent Note](../../../.agents/notes/implemented/architecture/2026-09-03-hosted-principal-isolation.md).

## Config

- `killSwitch` (default `false`) — mutating workspace, session-create, and git RPCs fail with `kill-switch`.
- `checkoutRoot` — absolute directory; required when principal authenticators are mounted and `createGit` omits `checkoutParent`.
- `maxWorkspacesPerUser` (default `0`) — durable workspace records per tenant+user.
- `maxConcurrentSessionsPerUser` (default `0`) — live sessions attached to that owner's workspaces.
- `maxGitOpsPerMinute` (default `0`) — status/commit/push/pull/branch calls per user per rolling minute (process-local).

A relative `checkoutRoot` or a negative cap fails at load.

## Model Experience

### Request context and condition

#### What the model sees

Nothing. Limits are host-side policy.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

- Git rate limits are in-process memory; multiple Host processes do not share a counter.
- Container-per-user isolation is not in this slice; checkout-directory isolation is.
- Dedicated durable audit records are not in this package; rejections surface as Host RPC errors and process logs.
