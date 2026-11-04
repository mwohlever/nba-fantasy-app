#!/usr/bin/env bash
set -euo pipefail
NBA_RUNNER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NBA_RUNNER_BASE="${XDG_DATA_HOME:-$HOME/.local/share}/111sports-recovery"
export LD_LIBRARY_PATH="$NBA_RUNNER_BASE/pg17/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$NBA_RUNNER_BASE/runner-venv/bin/python" "$NBA_RUNNER_DIR/cleanup_runner.py" "$@"
