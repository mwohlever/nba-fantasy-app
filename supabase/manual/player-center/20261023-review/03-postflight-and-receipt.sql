\set ON_ERROR_STOP on
begin;
\ir 00-mapping-inputs.sql
do $verify$ begin
  if (select count(*) from pg_trigger where tgrelid='public.nba_player_provider_identities'::regclass and not tgisinternal)<>1 or not exists(select 1 from pg_trigger where tgrelid='public.nba_player_provider_identities'::regclass and tgname='nba_provider_identity_updated_at' and tgenabled='O' and tgtype=19 and tgfoid='public.set_nba_projection_updated_at()'::regprocedure) then raise exception 'Unexpected identity triggers'; end if;
  if (select btrim(regexp_replace(prosrc,'[[:space:]]+',' ','g')) from pg_proc where oid='public.set_nba_projection_updated_at()'::regprocedure) is distinct from 'begin new.updated_at=clock_timestamp(); return new; end;' then raise exception 'Unexpected function body: set_nba_projection_updated_at'; end if;
  if (select count(*) from _pc_targets)<>98 or (select count(distinct provider_player_id) from _pc_targets)<>98 or (select count(distinct player_id) from _pc_targets)<>98 then raise exception 'Invalid target set'; end if;
  if exists ((select * from _pc_players except select id,name,nba_player_id,team_abbreviation,is_active from public.players) union all (select id,name,nba_player_id,team_abbreviation,is_active from public.players except select * from _pc_players)) then raise exception 'Player catalog drift: re-review'; end if;
  if exists ((select * from _pc_base except select a.* from public.nba_player_provider_identities a where not exists(select 1 from _pc_targets t where t.provider=a.provider and t.provider_player_id=a.provider_player_id)) union all (select a.* from public.nba_player_provider_identities a where not exists(select 1 from _pc_targets t where t.provider=a.provider and t.provider_player_id=a.provider_player_id) except select * from _pc_base)) then raise exception 'Baseline identity drift: re-review'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id) where (to_jsonb(a)-'created_at'-'updated_at') is distinct from (to_jsonb(t)-'created_at'-'updated_at')) then raise exception 'Target ID claimed or changed'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_targets t on a.player_id=t.player_id where a.provider_player_id<>t.provider_player_id or a.provider<>'espn') then raise exception 'Local player already mapped elsewhere'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_unresolved u on u.player_id=a.player_id) then raise exception 'Unresolved cohort changed'; end if;
 if (select count(*) from public.nba_player_provider_identities)<>465 then raise exception 'Expected 465 mappings'; end if; end $verify$;
\copy (select a.* from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id) order by a.provider_player_id) to 'nba-identities-after.csv' with(format csv,header true)
select 'VERIFIED' as result,count(*) as mapped_active_players from public.nba_player_provider_identities i join public.players p on p.id=i.player_id where i.resolution_status='resolved' and p.is_active;
commit;
