#!/usr/bin/env bash
# Bounded checkout install from docs/INSTALL.md. Idempotent: PRE refuses an
# existing node_modules, so a rerun removes it before the graph gate.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -e node_modules ]; then
  rm -rf node_modules
fi

node scripts/version-p1-install-smoke.mjs --preinstall
npm ci --ignore-scripts --no-audit
node scripts/version-p1-install-smoke.mjs
npm run build
