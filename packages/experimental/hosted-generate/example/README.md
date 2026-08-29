---
description: "Runnable loopback generate composition over the agent spine with filesystem write tools and no bash, for CoreNet and Hosting POC callers."
kind: "package-reference"
---

# hosted-generate

English | [中文](README.zh.md)

## Summary

Loopback composition that mounts [`dsh-experimental-hosted-generate`](../README.md) over the agent spine with filesystem write tools and **no bash**. A logged-in product (CoreNet or Hosting) POSTs a prompt and receives a UTF-8 file map; that product deploys.

This leaf is a cost-constrained POC: bind `127.0.0.1`, one generation at a time, no Azure session containers, and keyless tests use `dsh-llm-mock-server` so CI spends no model tokens. It is not a published npm package and does not add a `dsh --profile` entry.

## Table of Contents

- [Test (keyless)](#test-keyless)
- [Azure (Envon, scale to zero)](#azure-envon-scale-to-zero)
- [HTTP](#http)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="test-keyless"></a>
## Test (keyless)

From this repository root:

```sh
pnpm run test:hosted-generate
```

That is the first path to run. Vite may print a `vite-tsconfig-paths` plugin notice; it is a warning, not a failure.

To curl the API yourself (still no provider key):

```sh
pnpm run demo:hosted-generate
```

Then in another terminal:

```sh
curl -sS -X POST http://127.0.0.1:3081/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"a one-page hello site"}'
# wait for completed, replacing SESSION with the returned sessionId
curl -sS http://127.0.0.1:3081/sessions/SESSION
curl -sS http://127.0.0.1:3081/sessions/SESSION/artifact
```

The mock writes a fixed `index.html` on the first generation. Optional live-model smoke (self-skips without `DEEPSEEK_API_KEY`) lives in [`../tests/live.e2e.ts`](../tests/live.e2e.ts) and is part of `pnpm run test:e2e`.

-----

<a id="azure-envon-scale-to-zero"></a>
## Azure (Envon, scale to zero)

Live app `ca-envon-generate-poc` on `cae-envon-prd-eus2-01` serves the Harness **web UI** and the generate HTTP contract. Image: `packages/experimental/hosted-generate/example/azure/Dockerfile.web` (`@deepseek-ai/dsh@0.1.1-rc.2`). `dsh web` binds `127.0.0.1:3080`; `generate-server.mjs` binds `127.0.0.1:3081` and runs `dsh --profile headless` with `grok.patch.yml` plus `generate.patch.yml` (filesystem tools only). `web-proxy.mjs` binds `0.0.0.0:8080`, requires `GENERATE_TOKEN` as HTTP Basic password or `Authorization: Bearer`, and routes `/generate` and `/sessions/` to the generate server. `--trusted-host` is the Container App FQDN. Scale: `minReplicas=0` / `maxReplicas=1` at 1.0 vCPU / 2 Gi.

Grok is the default model. `llm-bridge.mjs` translates pi-ai's OpenAI-compatible loopback calls to Envon Foundry deployment `grok-4-3` (`FOUNDRY_API_KEY`, private PE on the CAE VNet). Set `XAI_API_KEY` instead of `FOUNDRY_API_KEY` to use `https://api.x.ai/v1` (model `grok-4.3`).

`Dockerfile` + `server.mjs` remain the keyless generate-contract mock (no dsh, no model tokens). The Envon harness is a CloudOI surface, not a standalone dsh login: a CoreNet launch token (`GET /api/ai-build/harness-launch`) binds the session to that account, and completed generate calls `POST /api/ai-build/from-harness/launch` so CoreNet writes GitHub and `{slug}.cloudoi.dev`. Operator `GENERATE_TOKEN` remains for rehearsal. Isolation is still not multi-tenant.

-----

<a id="http"></a>
## HTTP

| Method | Path |
|---|---|
| `POST` | `/generate` `{ "prompt": "…" }` → `{ "sessionId" }` |
| `GET` | `/sessions/:id` |
| `GET` | `/sessions/:id/artifact` |

Set `DSH_HOSTED_GENERATE_TOKEN` to require `Authorization: Bearer`. `DSH_HOSTED_GENERATE_PORT` defaults to an OS-assigned port.

## Known Limitations and Deferred Work

See the package README. This leaf does not add a `dsh --profile` entry and does not bind all interfaces.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
