# Chromebook path: native PostgreSQL 17, no containers

Environment checked: Debian 12 amd64, ~12.4 GiB free disk, ~6.1 GiB available RAM. No PostgreSQL/Docker/Podman commands were initially on PATH. Verified official PGDG packages were downloaded and extracted privately under `~/.local/share/111sports-recovery/pg17/root`; no apt sources, system packages, background system service or shell startup files were changed. PGDG repository signature, index SHA-256 and package SHA-256 were verified. Tools/server are PostgreSQL 17.11, compatible with the production server's major version 17.

Use `pg17-tool.sh` for private clients and `native-cluster.sh` for the isolated local database. Local commands forcibly clear production connection variables, use a private Unix socket and disable TCP listening. This replaces Docker in the main README; its archive/approval/storage requirements remain unchanged.

## Exact first operator action

In the intended Supabase project `oororafwujfliscjasur`, open **Connect → Session pooler**. Obtain:

- Host exactly as displayed, ending in `.pooler.supabase.com`.
- Port **5432**, database **postgres**, user **postgres.oororafwujfliscjasur**.
- Your existing **database password**, not an anon/service-role API key.

Use Session mode, not Transaction mode/port 6543. The pooler provides IPv4 connectivity without relying on a Chromebook's external IPv6 support. Do not put the password in chat or Git. Enter it locally, hidden, with:

```bash
cd /home/markwohlever/nba-fantasy-app
python3 supabase/manual/nba-observation-history/recovery/configure-archive.py
```

This only prepares mode-600 service/password files in a mode-700 directory outside Git. It does not connect to production. The archive service sets `default_transaction_read_only=on`; never repurpose it for cleanup writes. SSL encryption is required. The password is not printed or placed in shell history.

## Archive commands, after the metadata/writer checkpoint

Keep SQL execution manual. Pause factual observation writers and capture metadata.json in SQL Editor as required by the main README before starting this snapshot. No pause or production read is performed automatically by these helpers.

```bash
NBA_RECOVERY_TOOLS="$PWD/supabase/manual/nba-observation-history/recovery"
NBA_RECOVERY_ARCHIVE="$HOME/.local/share/111sports-recovery/archive-20261027"
export PGSERVICEFILE="$NBA_RECOVERY_ARCHIVE/service.conf"
df -h "$NBA_RECOVERY_ARCHIVE"
bash "$NBA_RECOVERY_TOOLS/pg17-tool.sh" pg_dump \
  --dbname='service=111sports-production' --format=custom --lock-wait-timeout=5s \
  --table=public.nba_player_game_observation_versions \
  --table=public.nba_player_game_current_observations \
  --file="$NBA_RECOVERY_ARCHIVE/observations.dump"
bash "$NBA_RECOVERY_TOOLS/pg17-tool.sh" pg_dump \
  --dbname='service=111sports-production' --schema-only --schema=public \
  --lock-wait-timeout=5s --file="$NBA_RECOVERY_ARCHIVE/public-schema.sql"
bash "$NBA_RECOVERY_TOOLS/pg17-tool.sh" pg_restore \
  --list "$NBA_RECOVERY_ARCHIVE/observations.dump" > "$NBA_RECOVERY_ARCHIVE/archive.contents"
```

Require at least **10 GiB free** before the full archive/export/rehearsal workflow, successful dump exit codes, and the complete metadata.json. Avoid other large downloads while rehearsing. Save SHA-256 checksums and a second encrypted/versioned external copy as in README; the two private connection files must not be included in shared archive material.

## Isolated native restore

These commands affect only the local Unix-socket database, regardless of the archive service environment:

```bash
bash "$NBA_RECOVERY_TOOLS/native-cluster.sh" start
python3 "$NBA_RECOVERY_TOOLS/prepare.py" bootstrap \
  "$NBA_RECOVERY_ARCHIVE/metadata.json" "$NBA_RECOVERY_ARCHIVE/bootstrap-local.sql"
bash "$NBA_RECOVERY_TOOLS/native-cluster.sh" restore --section=pre-data \
  --dbname=postgres "$NBA_RECOVERY_ARCHIVE/observations.dump"
bash "$NBA_RECOVERY_TOOLS/native-cluster.sh" restore --section=data \
  --dbname=postgres "$NBA_RECOVERY_ARCHIVE/observations.dump"
bash "$NBA_RECOVERY_TOOLS/native-cluster.sh" psql \
  --file="$NBA_RECOVERY_ARCHIVE/bootstrap-local.sql"
bash "$NBA_RECOVERY_TOOLS/native-cluster.sh" restore --section=post-data \
  --dbname=postgres "$NBA_RECOVERY_ARCHIVE/observations.dump"
bash "$NBA_RECOVERY_TOOLS/native-cluster.sh" psql -Atq \
  --file="$NBA_RECOVERY_TOOLS/verify.sql" > "$NBA_RECOVERY_ARCHIVE/restored-baseline.txt"
bash "$NBA_RECOVERY_TOOLS/native-cluster.sh" psql -Atq \
  --file="$NBA_RECOVERY_TOOLS/manifest-local.sql" > "$NBA_RECOVERY_ARCHIVE/manifest.jsonl"
python3 "$NBA_RECOVERY_TOOLS/prepare.py" batches \
  "$NBA_RECOVERY_ARCHIVE/manifest.jsonl" "$NBA_RECOVERY_ARCHIVE/review-batches"
```

The local cluster must be empty before its first restore; helpers never drop/reset an existing cluster automatically. Verify 1,502,003 history rows, 34,386 current rows, current checksum equal to captured metadata, zero integrity errors, and the exact READY.json totals. Follow the main README for local recovery-row export/deletion/recovery rehearsal, replacing Docker psql calls with `bash "$NBA_RECOVERY_TOOLS/native-cluster.sh" psql` and using real local paths rather than `/archive/...` in local `\copy` commands. No production data modification is authorized by these preparation commands.

Local server status/stop:

```bash
bash "$NBA_RECOVERY_TOOLS/native-cluster.sh" status
bash "$NBA_RECOVERY_TOOLS/native-cluster.sh" stop
```

Repository push safety: root `vercel.json` disables Git deployments only for `maintenance/nba-observation-recovery`. Main and its deployment settings are unchanged. The commit also carries `[skip ci]`; no PR merge or application deployment is part of this maintenance work.
