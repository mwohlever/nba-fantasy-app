-- MANUAL EXECUTION ONLY. Apply before deploying the Batch 4 application.
-- No rows are deleted, renamed, reassigned, or otherwise rewritten.
begin;

-- Keep schema verification and team index replacement atomic against writes.
lock table public.slates, public.teams in share row exclusive mode;

do language plpgsql $batch4_checks$
begin
  -- User-verified live schema already has league-scoped slate uniqueness.
  -- Verify it exactly, including the predicate; do not recreate or narrow it.
  if not exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'slates_league_sport_external_event_id_unique'
      and i.indrelid = 'public.slates'::regclass
      and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
      and not i.indisprimary
      and i.indnkeyatts = 3 and i.indnatts = 3
      and pg_get_indexdef(i.indexrelid, 1, true) = 'league_id'
      and pg_get_indexdef(i.indexrelid, 2, true) = 'sport'
      and pg_get_indexdef(i.indexrelid, 3, true) = 'external_event_id'
      and pg_get_indexdef(i.indexrelid) =
        'CREATE UNIQUE INDEX slates_league_sport_external_event_id_unique ON public.slates USING btree (league_id, sport, external_event_id) WHERE (external_event_id IS NOT NULL)'
      and pg_get_expr(i.indpred, i.indrelid) = '(external_event_id IS NOT NULL)'
      and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
  ) then
    raise exception 'Batch 4 stopped: unexpected or missing slates_league_sport_external_event_id_unique; inspect pg_indexes before proceeding';
  end if;
  if to_regclass('public.slates_sport_external_event_id_unique') is not null then
    raise exception 'Batch 4 stopped: unexpected obsolete global slate index still exists; inspect schema';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.teams'::regclass and conname = 'teams_name_key'
      and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (name)'
  ) then
    raise exception 'Batch 4 stopped: unexpected or missing teams_name_key; inspect pg_constraint before proceeding';
  end if;
  if exists (
    select 1 from public.slates
    where league_id is not null and external_event_id is not null
    group by league_id, sport, external_event_id having count(*) > 1
  ) then
    raise exception 'Batch 4 stopped: duplicate scoped slate events; inspect rows without deleting history';
  end if;
  if exists (
    select 1 from public.teams where name is not null
    group by group_id, name having count(*) > 1
  ) then
    raise exception 'Batch 4 stopped: duplicate scoped team names; resolve policy before proceeding';
  end if;
end;
$batch4_checks$;

-- No slate index changes. NULL-league rows retain the live index's existing
-- NULL-distinct behavior. Current creation supplies league_id; Groups foundation
-- backfills legacy ownership and assigns it on legacy inserts. No unowned
-- external-event rows were observed, so no new legacy namespace is imposed.

create unique index teams_group_name_unique
  on public.teams (group_id, name) where group_id is not null;
create unique index teams_legacy_name_unique
  on public.teams (name) where group_id is null;

-- Both team namespaces are protected before removing the verified global rule.
alter table public.teams drop constraint teams_name_key;

commit;
