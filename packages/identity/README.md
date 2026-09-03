# identity/ — shared identity

English | [中文](README.zh.md)

Identity values shared across product domains. Anonymous telemetry ids are not authenticated accounts; `ctx.principal` is the authenticated Host caller.

| Package | Role | ctx key |
|---|---|---|
| [`anonymous-user-id/`](anonymous-user-id/README.md) | Persists one anonymous Harness-home correlation id for telemetry, feedback, and DeepSeek requests | — |
| [`principal/`](principal/README.md) | Request-scoped authenticated caller and authenticator registry | `ctx.principal` |
| [`principal-hmac/`](principal-hmac/README.md) | CoreNet HMAC launch-token authenticator (`harness_launch`) | registers into `ctx.principal` |
| [`hosted-limits/`](hosted-limits/README.md) | Kill switch, per-user caps, git rate limit, isolated checkout root | `ctx.hostedLimits` |
