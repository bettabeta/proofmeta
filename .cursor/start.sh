#!/usr/bin/env bash
# Reference provider. e2e binds 127.0.0.1:4101 itself, so this stays on 4100.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f packages/sdk-ts/dist/index.js ]; then
  echo "SDK build missing. Run bash .cursor/install.sh" >&2
  exit 1
fi

if timeout 2 bash -c 'echo >/dev/tcp/127.0.0.1/4100' >/dev/null 2>&1; then
  echo "provider already listening on 127.0.0.1:4100"
  exit 0
fi

export HOST=127.0.0.1
export PORT=4100
export PUBLIC_ORIGIN=http://127.0.0.1:4100
exec node examples/provider/server.mjs
