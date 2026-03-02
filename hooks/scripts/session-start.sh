#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
node "$PLUGIN_ROOT/scripts/session-start-loader.js" "$PLUGIN_ROOT"
