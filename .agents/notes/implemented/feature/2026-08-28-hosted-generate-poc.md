# Agent Note: Hosted generate POC for CoreNet and Hosting

Status: implemented

English | [中文](2026-08-28-hosted-generate-poc.zh.md)

## Problem

CoreNet and Hosting each need a logged-in user to describe a website or app and receive files the product can deploy. The current builders are single-shot text fills. DeepSeek Harness can run a tool-using Agent, but it is a local single-operator runtime: anonymous identity, loopback-only Web by default, process-local sandbox, and no generate/artifact HTTP contract. Putting the stock `dsh web` UI on Envon compute would expose remote code execution and unbounded model spend.

A shared generator must not write DNS or deploy, must not hold provider keys, and a cost-constrained POC cannot provision per-session Azure containers or call paid models in CI.

## Decision

`@deepseek-ai/dsh-experimental-hosted-generate` is a private experimental service (`ctx.hostedGenerate`) plus optional routes on `ctx.webServer`. Each `start()` call creates one disposable directory, one Agent whose `cwd` is that directory, waits for quiescence under `sessionTimeoutMs` and `maxSteps`, collects a UTF-8 file map, disposes the Agent, and deletes the directory. Completed records stay in process memory up to `maxRetainedSessions`. Default `maxConcurrentSessions` is 1. HTTP binds through the existing web server, which remains loopback in the example composition. An empty `authToken` disables bearer checks; a non-empty token is required as `Authorization: Bearer`.

The plugin never deploys, never writes DNS, and never stores provider keys. LLM traffic uses whatever adapter the composition mounted. Keyless tests drive `MockAdapter` or `dsh-llm-mock-server`. The Envon harness is a CloudOI surface: CoreNet (and later Hosting) mint a launch token after their own login so the user is not a second account. `POST /api/ai-build/from-harness` is the CoreNet publish path (GitHub + `*.cloudoi.dev`). Products remain the only writers of GitHub, DNS, and hosting resources.

Isolation for this POC is one Node process plus a temp directory, not Landlock and not a container. That is adequate only for loopback, single-tenant, trusted-operator rehearsal.

The example leaf `examples/hosted-generate` composes the service over `dsh-agent-spine-demo` with `toolBash: false` and `toolJobs: false`, so the Agent can write files and cannot start subprocesses. That keeps the POC off `npm install` and image builds.

## Alternatives considered

**Ship the Web profile on `0.0.0.0`.** Rejected for the OSS CLI: it blocks all-interfaces bind because it exposes the tool runtime, and the web server has no auth. A generate API with a disposable cwd is a smaller product contract. The Azure rehearsal keeps that CLI refusal: `dsh web` binds `127.0.0.1:3080`, and `examples/hosted-generate/azure/web-proxy.mjs` publishes `0.0.0.0:8080` with `GENERATE_TOKEN` as Basic password or Bearer. That is single-operator access control, not multi-tenant isolation.

**Per-session Azure Container Instances.** Rejected for this POC: idle and per-call ACI cost dominates a rehearsal that must run keyless. The service interface can later swap workspace creation for a remote execution-world provider without changing the HTTP map.

**Tarball artifacts.** Rejected: CoreNet already ingests a path-to-content map, Hosting's static publisher wants files, and a JSON map needs no extra dependency.

**Mount bash and a full coding spine.** Rejected for the first slice: file-only generation proves the occupancy, wipe, and HTTP path at zero subprocess cost. Bash can return as a composition change once token caps and isolation are accepted.

## Consequences

Callers (CoreNet `AiBuildController`, Hosting `EnvonAiSiteBuilder`) can POST a prompt and receive files without teaching dsh about SWA, Caddy, or GitHub. CI can fully exercise the path without `DEEPSEEK_API_KEY` or Azure. The POC does not protect two mutually untrusted customers in one process; production isolation remains a later provider swap. Unbounded live-model spend is still possible if a composition points the adapter at a paid endpoint without the session caps — those caps are the cost control this package owns.

Envon Container App `ca-envon-generate-poc` (`examples/hosted-generate/azure/Dockerfile.web`) serves the published `dsh web` UI behind that proxy and the generate HTTP contract on `/generate` and `/sessions/`. Generate runs `dsh --profile headless` with filesystem tools only (`generate.patch.yml`). Grok is the default model via `llm-bridge.mjs`: Foundry deployment `grok-4-3` when `FOUNDRY_API_KEY` is set (CAE VNet private PE), otherwise `https://api.x.ai/v1` with `XAI_API_KEY`. Scale remains `minReplicas=0` / `maxReplicas=1`. The keyless generate mock (`Dockerfile` + `server.mjs`) is unchanged. CoreNet overlays the returned file map onto its scaffold and remains the GitHub writer.
