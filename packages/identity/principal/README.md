# @deepseek-ai/dsh-principal

English | [中文](README.zh.md)

Request-scoped product principal (`ctx.principal`) for DeepSeek Harness Host RPC. Authenticators register by id and identify a caller from an HTTP request; `run` binds that caller on `AsyncLocalStorage` so workspace ownership and checkout isolation can read `current()` without threading a request object. The default `dsh web` composition does not mount this service. A mounted service with zero authenticators authorizes like an unmounted one (every workspace remains visible, `create({ path })` is unchanged). Tokens are never stored on the service. Decision record: [hosted principal Agent Note](../../../.agents/notes/implemented/architecture/2026-09-03-hosted-principal-isolation.md).

## Shape

- `ctx.principal.register(authenticator)` — registers one identification strategy. A duplicate `id` throws. The disposer unregisters on fiber disposal.
- `hasAuthenticators()` — true when at least one authenticator is registered; workspace filtering and isolated git checkouts key off this, not service presence.
- `bindFromRequest(request)` — first matching authenticator wins; does not bind ALS.
- `run(principal, fn)` / `current()` / `require(action)` — bind and read the caller for one async continuation. Concurrent `run` calls do not share a store.
- `logout(request)` — merges `Set-Cookie` clears from every authenticator. The HTTP carrier attaches those headers on `auth.logout`.

HMAC CoreNet launch cookies are a provider (`dsh-principal-hmac`), not this definition. OSS directory-picker `dsh web` stays unauthenticated.

## Model Experience

### Request context and condition

#### What the model sees

Nothing. `ctx.principal` serves host-side authorization only: the package registers no tools, injects no prompts, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

- Authenticators identify; they do not persist a revocation list. Expiry is the token's `exp`. Server-side revocation is a later provider concern.
- GitHub OAuth and other public-product issuers are later authenticators; this slice ships the HMAC CoreNet provider beside the definition.
