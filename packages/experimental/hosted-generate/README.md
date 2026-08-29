---
description: "Loopback generate API that returns a UTF-8 file map from a disposable workspace, for CoreNet and Hosting compositions that deploy the files themselves."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-hosted-generate

English | [中文](README.zh.md)

## Summary

Mount this experimental service when a logged-in product should POST a prompt and receive a UTF-8 file map it can deploy. `ctx.hostedGenerate` creates one Agent per request in a disposable workspace, waits for quiescence under time and step caps, returns the files, and wipes the workspace. It does not deploy, write DNS, or hold product credentials. Isolation is one process plus a temp directory, not a container.

The [hosted-generate Agent Note](../../../.agents/notes/implemented/feature/2026-08-28-hosted-generate-poc.md) owns isolation, cost, and generate/deploy split decisions. The runnable leaf is [`example/`](example/README.md).

## Table of Contents

- [Config](#config)
- [HTTP](#http)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="config"></a>
## Config

```yaml
- id: hosted-generate
  name: '@deepseek-ai/dsh-experimental-hosted-generate'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
    maxConcurrentSessions: 1
    sessionTimeoutMs: 30000
    maxSteps: 6
    maxArtifactBytes: 262144
    maxFiles: 16
    maxFileBytes: 65536
    maxPromptBytes: 16384
    maxRetainedSessions: 8
    workspaceParent: /tmp
    authToken: ''
    printListen: false
```

`provider` and `model` are required. Every other field has a default. `authToken` empty disables HTTP authentication. `printListen` writes one loopback URL line when `ctx.webServer` is mounted.

-----

<a id="http"></a>
## HTTP

When `ctx.webServer` is mounted, the plugin registers:

| Method | Path | Result |
|---|---|---|
| `POST` | `/generate` | `202 { sessionId }` |
| `GET` | `/sessions/:id` | status |
| `GET` | `/sessions/:id/artifact` | `{ sessionId, files }` |

`files` is a posix-relative UTF-8 map. Hidden names, `node_modules`, `.git`, `.sessions`, and non-UTF-8 bytes are omitted. Crossing `maxFiles` or byte caps fails the generation. Products deploy the map; this plugin never does.

-----

<a id="model-experience"></a>
## Model Experience

### Generation instructions

#### What the model sees

A `app:hosted-generate` system-prompt section (order −50) carrying `taskGuidance`. The same text is prepended to the user prompt as `User request:`.

##### Default `taskGuidance`

```markdown
Generate a static website or small app in this workspace. Write UTF-8 files under the workspace root. Do not deploy, do not use network services, and do not read files outside the workspace. Stop when the files are ready.
```

#### Token effect

One constant instruction paragraph per session plus the user prompt.

#### KV Cache effect

The section is process-stable. The user prompt is append-only.

## Known Limitations and Deferred Work

- **Process-local isolation only** — Landlock/Seatbelt and per-session containers are out of this POC; bind loopback and keep `maxConcurrentSessions` at 1.
- **No deploy, DNS, or GitHub** — callers persist and publish the file map.
- **LLM spend is the caller's adapter** — this package never holds a provider key; tests use a mock or `dsh-llm-mock-server`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
