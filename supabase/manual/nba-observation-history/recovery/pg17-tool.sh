#!/usr/bin/env bash
set -euo pipefail
NBA_RECOVERY_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/111sports-recovery/pg17/root"
NBA_RECOVERY_BIN="$NBA_RECOVERY_ROOT/usr/lib/postgresql/17/bin"
if [[ ! -x "$NBA_RECOVERY_BIN/pg_dump" ]]; then
  printf '%s\n' 'Private PostgreSQL 17 binaries are missing; see CHROMEBOOK.md.' >&2
  exit 1
fi
NBA_RECOVERY_TOOL="${1:?Specify pg_dump, pg_restore, psql, initdb, pg_ctl, or postgres}"
shift
case "$NBA_RECOVERY_TOOL" in
  pg_dump|pg_restore|psql|initdb|pg_ctl|postgres) ;;
  *) printf '%s\n' 'Unsupported PostgreSQL tool' >&2; exit 1 ;;
esac
export LD_LIBRARY_PATH="$NBA_RECOVERY_ROOT/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$NBA_RECOVERY_BIN/$NBA_RECOVERY_TOOL" "$@"
