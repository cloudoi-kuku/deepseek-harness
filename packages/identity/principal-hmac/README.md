# @deepseek-ai/dsh-principal-hmac

English | [中文](README.zh.md)

HMAC authenticator for `ctx.principal` using the CoreNet `HarnessLaunchToken` algorithm (`payload.signature`, claims `tid`, `uid`, `product?`, `exp`). Cookie name defaults to `harness_launch`; `Authorization: Bearer` is accepted as well. This is the in-process re-validation of the hosted overlay launch cookie — the overlay proxy keeps its own copy in `examples/hosted-generate/azure/launch-token.mjs`. Default `dsh web` does not mount this plugin. Decision record: [hosted principal Agent Note](../../../.agents/notes/implemented/architecture/2026-09-03-hosted-principal-isolation.md).

## Config

- `secret` (required) — HMAC key shared with CoreNet / the overlay. Empty fails at load.
- `cookieName` (default `harness_launch`) — cookie parsed before Bearer.
- `secureCookie` (default `true`) — logout `Set-Cookie` includes `Secure`.
- `product` (optional) — when set, claims.product must equal this value.

`auth.logout` clears the cookie (`Max-Age=0`). Email is never read. Tokens are never written to workspace records.

## Model Experience

### Request context and condition

#### What the model sees

Nothing. The authenticator only identifies Host RPC callers.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

- Expiry is `exp` only; there is no server-side revocation set.
- The overlay proxy still HMAC-gates at the edge. This plugin is additive so dsh does not trust forwarded identity headers.
