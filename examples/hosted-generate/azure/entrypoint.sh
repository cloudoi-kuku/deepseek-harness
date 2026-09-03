#!/bin/sh
# Loopback Grok bridge and dsh web, then the public proxy on $PORT.
# The proxy binds immediately so Container Apps ingress can probe /health
# while dsh is still loading.
set -eu

export HOME="${HOME:-/home/node}"
export DSH_HOME="${DSH_HOME:-${HOME}/.dsh}"
export LLM_API_KEY="${LLM_API_KEY:-bridge}"
DSH_PORT="${DSH_PORT:-3080}"
TRUSTED_HOST="${TRUSTED_HOST:-ca-envon-generate-poc.calmtree-51c0c4fa.eastus2.azurecontainerapps.io}"

mkdir -p "${DSH_HOME}" /workspace
cd /workspace

if [ -z "${FOUNDRY_API_KEY:-}${XAI_API_KEY:-}" ]; then
  echo "hosted-generate-web: FOUNDRY_API_KEY or XAI_API_KEY is required" >&2
  exit 1
fi

node /app/llm-bridge.mjs &
BRIDGE_PID=$!

dsh --profile web --patch /app/grok.patch.yml --no-open --port "${DSH_PORT}" --trusted-host "${TRUSTED_HOST}" &
DSH_PID=$!

node /app/generate-server.mjs &
GENERATE_PID=$!

term() {
  kill "${BRIDGE_PID}" "${DSH_PID}" "${GENERATE_PID}" 2>/dev/null || true
}
trap term TERM INT EXIT

node /app/web-proxy.mjs
