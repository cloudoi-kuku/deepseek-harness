# Agent Note: Envon Harness GitHub workspace at dsh web `/`

Status: implemented

English | [中文](2026-08-29-envon-github-cwd.zh.md)

## Problem

Envon Harness is DeepSeek Harness: the customer product is `dsh web` at `/`, not a one-shot generate form. Session `meta.cwd` is an absolute local path. A CoreNet user arrives with a launch HMAC and a GitHub account, not a laptop folder. The GitHub token must not ride in `/?launch=` (Referer, history, access logs). dsh must not write DNS or deploy; CoreNet still owns `{slug}.cloudoi.dev`. Published `dsh@0.1.1-rc.2` has no GitHub/GCS/OneDrive workspace provider.

## Decision

CoreNet `CreateHarnessLaunch` mints `{HarnessPublicUrl}/?launch={hmac}`. Envon `web-proxy.mjs` validates that token, then `GET /api/ai-build/from-harness/workspace` with the same token as Bearer. CoreNet uses the stored GitHub OAuth token (not the CoreNet JWT) to ensure a private `cloudoi-harness` repository for that GitHub user, seeds `README.md` when the repo is empty, and returns `{kind,owner,name,cloneUrl,token,defaultBranch}`. Envon clones that tree into `/workspace` (the `dsh --profile web` cwd started from `entrypoint.sh`), writes the token to `~/.git-credentials` (mode 0600), and `git push`es dirty files on a timer. After the clone, Envon POSTs dsh `workspace.create` (`/api/workspace.create`, the published `0.1.1-rc.2` apiproxy path) for `/workspace` (title `owner/name`) so the web composer is live; the directory picker is not required. GET `/` with a launch cookie remounts and re-pins so a recycled replica still skips the picker. `/new` 302s to `/`. `POST /generate` remains the headless file-map path for the CoreNet wizard. Isolation is still one process and one `/workspace`.

The GitHub token is absent from the launch query string. The launch HMAC is reusable until its 10-minute expiry (Envon cookie and CoreNet `from-harness/*` share it); it does not carry email. dsh still does not talk to SWA, Caddy, or DNS.

## Alternatives considered

**Put the GitHub token in the launch query string.** Rejected: browsers and proxies copy query strings into Referer, history, and access logs. The HMAC launch token is the join; the clone grant is a separate authenticated GET.

**Keep `/new` as the customer home.** Rejected: Envon Harness is the full `dsh web` UI. The generate HTML form is not that product. `/new` redirects to `/`.

**Ship `local|github|gcs|onedrive` providers inside `dsh-workspace` with `resolve(request) → spec`.** Deferred. This slice materializes GitHub as a local directory so the published CLI's cwd contract works without a new OSS package or an npm release past `0.1.1-rc.2`. GCS, OneDrive, and Hosting site trees wait on that capability.

**Mint a one-hour GitHub App installation token.** Deferred. CoreNet already stores the user's OAuth token; a short-lived clone credential is the next tightening, not a blocker for the first attached path.

## Consequences

A GitHub-connected CoreNet user opening `https://harness.cloudoi.io/?launch=…` lands on `dsh web` whose workspace is already that GitHub tree (`owner/cloudoi-harness`); they can type immediately. A replica still has one cwd, so two overlapping launches share `/workspace`. The GitHub OAuth token is readable by the Envon process and by git; callers must not log `HarnessWorkspaceResponse.Token`. Hosting is unchanged (`product: hosting` is not minted). Native workspace providers remain future work; this note does not claim they shipped.

## Testing

`HarnessWorkspaceTests` covers launch URL `/?launch=` (not `/new`), create-on-404, reuse-without-seed, and missing GitHub token. `packages/experimental/hosted-generate/tests/workspace-github.spec.ts` covers grant JSON parse, token-free clone URL, Bearer fetch, stderr redaction, the dsh `workspace.create` RPC envelope, rename to `owner/name`, retry while dsh is down, and fail-loud business RPC errors.

## Related

[Hosted generate POC](2026-08-28-hosted-generate-poc.md) still owns generate occupancy, cost caps, and the generate/deploy split. [Standalone Git IDE beside CoreNet](2026-09-03-envon-standalone-and-corenet-entry.md) owns the unauthenticated landing, GENERATE_TOKEN `dsh web`, and `/clone`. CoreNet path: `docs/envon-harness-corenet-path.md` in the CoreNet repo.
