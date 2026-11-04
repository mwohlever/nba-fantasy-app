#!/usr/bin/env bash
set -euo pipefail
NBA_RECOVERY_TOOLS="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NBA_RECOVERY_STATE="${XDG_DATA_HOME:-$HOME/.local/share}/111sports-recovery/rehearsal17"
NBA_RECOVERY_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/111sports-recovery/pg17/root"
NBA_RECOVERY_ACTION="${1:?Specify start, stop, status, psql, or restore}"
shift
umask 077
mkdir -p "$NBA_RECOVERY_STATE/socket"
unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGPASSWORD PGPASSFILE PGOPTIONS
export PGHOST="$NBA_RECOVERY_STATE/socket" PGPORT=55447 PGUSER=nba_recovery PGDATABASE=postgres PGSSLMODE=disable
case "$NBA_RECOVERY_ACTION" in
  start)
    if [[ ! -f "$NBA_RECOVERY_STATE/data/PG_VERSION" ]]; then
      bash "$NBA_RECOVERY_TOOLS/pg17-tool.sh" initdb -D "$NBA_RECOVERY_STATE/data" \
        -L "$NBA_RECOVERY_ROOT/usr/share/postgresql/17" \
        --auth=trust --username=nba_recovery --encoding=UTF8 --no-locale
    fi
    if ! bash "$NBA_RECOVERY_TOOLS/pg17-tool.sh" pg_ctl -D "$NBA_RECOVERY_STATE/data" status >/dev/null 2>&1; then
      bash "$NBA_RECOVERY_TOOLS/pg17-tool.sh" pg_ctl -D "$NBA_RECOVERY_STATE/data" \
        -l "$NBA_RECOVERY_STATE/server.log" -w start \
        -o "-k $PGHOST -p $PGPORT -c listen_addresses='' -c jit=off -c timezone=UTC -c shared_buffers=128MB"
    fi
    ;;
  stop) bash "$NBA_RECOVERY_TOOLS/pg17-tool.sh" pg_ctl -D "$NBA_RECOVERY_STATE/data" -m fast -w stop ;;
  status) bash "$NBA_RECOVERY_TOOLS/pg17-tool.sh" pg_ctl -D "$NBA_RECOVERY_STATE/data" status ;;
  psql) bash "$NBA_RECOVERY_TOOLS/pg17-tool.sh" psql -X --set=ON_ERROR_STOP=1 "$@" ;;
  restore) bash "$NBA_RECOVERY_TOOLS/pg17-tool.sh" pg_restore --exit-on-error --no-owner --no-privileges "$@" ;;
  *) printf '%s\n' 'Unsupported local cluster action' >&2; exit 1 ;;
esac
