\set ON_ERROR_STOP on
-- REVIEW ONLY. Requires separate production approval. No script in this bundle executes SQL.
begin;
set local search_path=pg_catalog,pg_temp,public;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$ begin
  if current_setting('sports111.rollout_approval',true) is distinct from 'rollback-mappings:7e13a622d44c939b26bd910551714972f221b4d172bace20b757fff6ccf0acd4' then
    raise exception 'Missing exact reviewed operation approval';
  end if;
  if current_setting('sports111.backup_receipt',true) is distinct from '6b366f6fc336bd0f69c49aa12285d55dffa8b8bbbec600dc16dde0e0a1c4d6c1' then
    raise exception 'Missing reviewed backup receipt';
  end if;
end $guard$;
lock table public.nba_player_provider_identities in share row exclusive mode;
lock table public.players in share mode;
-- Block any concurrent dependency insertion while testing whether deletion is safe.
lock table public.nba_player_game_observation_versions in share mode;
lock table public.nba_projection_stat_cache in share mode;
\ir 00-mapping-inputs.sql
create temp table _pc_after(like public.nba_player_provider_identities) on commit drop;
-- This receipt is generated AFTER apply, in a new empty operator receipt directory.
\copy _pc_after from 'nba-identities-after.csv' with(format csv,header true)
do $rollback$ declare n integer; begin

  if (select count(*) from pg_trigger where tgrelid='public.nba_player_provider_identities'::regclass and not tgisinternal)<>1 or not exists(select 1 from pg_trigger where tgrelid='public.nba_player_provider_identities'::regclass and tgname='nba_provider_identity_updated_at' and tgenabled='O' and tgtype=19 and tgfoid='public.set_nba_projection_updated_at()'::regprocedure) then raise exception 'Unexpected identity triggers'; end if;
  if (select btrim(regexp_replace(prosrc,'[[:space:]]+',' ','g')) from pg_proc where oid='public.set_nba_projection_updated_at()'::regprocedure) is distinct from 'begin new.updated_at=clock_timestamp(); return new; end;' then raise exception 'Unexpected function body: set_nba_projection_updated_at'; end if;
  if (select count(*) from _pc_targets)<>98 or (select count(distinct provider_player_id) from _pc_targets)<>98 or (select count(distinct player_id) from _pc_targets)<>98 then raise exception 'Invalid target set'; end if;
  if exists ((select * from _pc_players except select id,name,nba_player_id,team_abbreviation,is_active from public.players) union all (select id,name,nba_player_id,team_abbreviation,is_active from public.players except select * from _pc_players)) then raise exception 'Player catalog drift: re-review'; end if;
  if exists ((select * from _pc_base except select a.* from public.nba_player_provider_identities a where not exists(select 1 from _pc_targets t where t.provider=a.provider and t.provider_player_id=a.provider_player_id)) union all (select a.* from public.nba_player_provider_identities a where not exists(select 1 from _pc_targets t where t.provider=a.provider and t.provider_player_id=a.provider_player_id) except select * from _pc_base)) then raise exception 'Baseline identity drift: re-review'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id) where (to_jsonb(a)-'created_at'-'updated_at') is distinct from (to_jsonb(t)-'created_at'-'updated_at')) then raise exception 'Target ID claimed or changed'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_targets t on a.player_id=t.player_id where a.provider_player_id<>t.provider_player_id or a.provider<>'espn') then raise exception 'Local player already mapped elsewhere'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_unresolved u on u.player_id=a.player_id) then raise exception 'Unresolved cohort changed'; end if;

  if (select count(*) from _pc_after)<>98 or exists(select 1 from _pc_after a left join _pc_targets t using(provider,provider_player_id) where t.provider_player_id is null or (to_jsonb(a)-'created_at'-'updated_at') is distinct from (to_jsonb(t)-'created_at'-'updated_at')) then raise exception 'Invalid after receipt'; end if;
  select count(*) into n from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id);
  if n not in(0,98) then raise exception 'Partial mapping rollback state'; end if;
  if n=98 then
    if exists((select a.* from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id) except select * from _pc_after) union all(select * from _pc_after except select a.* from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id))) then raise exception 'Mappings changed after receipt'; end if;
    if exists(select 1 from public.nba_player_game_observation_versions v join _pc_targets t on v.provider_player_id=t.provider_player_id or v.local_player_id=t.player_id) or exists(select 1 from public.nba_projection_stat_cache c join _pc_targets t on c.player_id=t.player_id) then raise exception 'Dependent evidence/cache exists: keep mappings; approve a corrective plan'; end if;
    if to_regclass('public.player_center_season_cache') is not null then
      if exists(select 1 from public.player_center_season_cache c join _pc_targets t on c.sport='nba' and (c.provider_player_id=t.provider_player_id or c.nba_local_player_id=t.player_id)) then raise exception 'Player Center cache depends on mappings'; end if;
    end if;
  end if;
end $rollback$;
delete from public.nba_player_provider_identities a using _pc_after r where a.provider=r.provider and a.provider_player_id=r.provider_player_id and to_jsonb(a)=to_jsonb(r);
do $verify$ begin if exists((select * from _pc_base except select * from public.nba_player_provider_identities) union all(select * from public.nba_player_provider_identities except select * from _pc_base)) then raise exception 'Rollback baseline mismatch'; end if; end $verify$;
commit;
