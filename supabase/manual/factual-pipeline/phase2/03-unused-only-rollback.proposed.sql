-- PROPOSAL ONLY. Rollback is permitted ONLY before any new factual/pool usage.
-- After use: preserve all evidence/transitions/pools; roll app back behind feature
-- gates and forward-fix schema. Never delete new rows to force this rollback.
begin;
set local search_path=pg_catalog,public;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $$ declare c jsonb; begin
  if current_setting('sports111.factual_schema_approval',true) is distinct from 'rehearsal:unused_rollback_v1' then
    raise exception 'Reviewed isolated rollback required'; end if;
  lock table public.professional_player_roster_evidence,public.slate_player_pool_snapshots,public.slate_player_eligibility,
    public.nfl_player_game_observation_versions,public.nfl_observation_append_receipts,public.nfl_observation_append_heads in access exclusive mode;
  if exists(select 1 from public.professional_player_roster_evidence limit 1)
    or exists(select 1 from public.slate_player_pool_snapshots limit 1)
    or exists(select 1 from public.slate_player_eligibility limit 1)
    or exists(select 1 from public.nfl_observation_append_receipts limit 1)
    or exists(select 1 from public.nfl_observation_append_heads limit 1)
    or exists(select 1 from public.nfl_player_game_observation_versions where semantic_receipt_id is not null limit 1)
    or exists(select 1 from public.nfl_player_game_observation_versions where passing_yards<0 or rushing_yards<0 or receiving_yards<0 limit 1) then
    raise exception 'New factual storage has been used; rollback refused, preserve history and forward-fix';
  end if;
  c:=obj_description('public.nfl_observation_legacy_hash_unique'::regclass,'pg_class')::jsonb;
  if c->>'definition' is distinct from 'UNIQUE (provider, provider_player_id, provider_event_id, observation_hash)' then
    raise exception 'Unreviewed rollback constraint'; end if;
  drop index public.nfl_observation_legacy_hash_unique;
  alter table public.nfl_player_game_observation_versions drop constraint nfl_semantic_receipt_pair,
    drop constraint nfl_semantic_receipt_row,drop column semantic_receipt_id,drop column semantic_ordinal;
  execute format('alter table public.nfl_player_game_observation_versions add constraint %I %s',c->>'name',c->>'definition');
end $$;
drop function public.propose_append_nfl_observations(uuid,jsonb);
drop table public.nfl_observation_append_heads;
drop table public.nfl_observation_append_receipts;
drop function public.reject_nfl_append_receipt_mutation();
grant insert on public.nfl_player_game_observation_versions to service_role;
alter table public.nfl_player_game_observation_versions
  add constraint nfl_player_game_observation_versions_passing_yards_check check(passing_yards is null or passing_yards>=0),
  add constraint nfl_player_game_observation_versions_rushing_yards_check check(rushing_yards is null or rushing_yards>=0),
  add constraint nfl_player_game_observation_versions_receiving_yards_check check(receiving_yards is null or receiving_yards>=0);
drop trigger frozen_player_pool_slate_guard on public.slates;
drop function public.guard_frozen_player_pool();
drop trigger frozen_pool_league_scope_guard on public.leagues;
drop function public.guard_frozen_pool_league_scope();
drop function public.propose_read_slate_pool(bigint,uuid,uuid,text);
drop function public.propose_freeze_slate_pool(bigint,uuid,uuid,text,integer,timestamptz,timestamptz,jsonb);
drop table public.slate_player_eligibility;
drop table public.slate_player_pool_snapshots;
drop function public.guard_player_pool_insert();
drop function public.propose_resolve_roster(text,bigint,integer,timestamptz,timestamptz);
drop function public.propose_append_roster_evidence(jsonb);
drop table public.professional_player_roster_evidence;
drop function public.reject_factual_phase2_mutation();
commit;
