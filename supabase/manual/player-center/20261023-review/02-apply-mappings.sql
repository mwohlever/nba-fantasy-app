\set ON_ERROR_STOP on
-- REVIEW ONLY. Requires separate production approval. No script in this bundle executes SQL.
begin;
set local search_path=pg_catalog,pg_temp,public;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$ begin
  if current_setting('sports111.rollout_approval',true) is distinct from 'apply:7e13a622d44c939b26bd910551714972f221b4d172bace20b757fff6ccf0acd4' then
    raise exception 'Missing exact reviewed operation approval';
  end if;
  if current_setting('sports111.backup_receipt',true) is distinct from '6b366f6fc336bd0f69c49aa12285d55dffa8b8bbbec600dc16dde0e0a1c4d6c1' then
    raise exception 'Missing reviewed backup receipt';
  end if;
end $guard$;
lock table public.nba_player_provider_identities in share row exclusive mode;
lock table public.players in share mode;
\ir 00-mapping-inputs.sql
do $check$ declare n integer; begin

  if (select count(*) from pg_trigger where tgrelid='public.nba_player_provider_identities'::regclass and not tgisinternal)<>1 or not exists(select 1 from pg_trigger where tgrelid='public.nba_player_provider_identities'::regclass and tgname='nba_provider_identity_updated_at' and tgenabled='O' and tgtype=19 and tgfoid='public.set_nba_projection_updated_at()'::regprocedure) then raise exception 'Unexpected identity triggers'; end if;
  if (select btrim(regexp_replace(prosrc,'[[:space:]]+',' ','g')) from pg_proc where oid='public.set_nba_projection_updated_at()'::regprocedure) is distinct from 'begin new.updated_at=clock_timestamp(); return new; end;' then raise exception 'Unexpected function body: set_nba_projection_updated_at'; end if;
  if (select count(*) from _pc_targets)<>98 or (select count(distinct provider_player_id) from _pc_targets)<>98 or (select count(distinct player_id) from _pc_targets)<>98 then raise exception 'Invalid target set'; end if;
  if exists ((select * from _pc_players except select id,name,nba_player_id,team_abbreviation,is_active from public.players) union all (select id,name,nba_player_id,team_abbreviation,is_active from public.players except select * from _pc_players)) then raise exception 'Player catalog drift: re-review'; end if;
  if exists ((select * from _pc_base except select a.* from public.nba_player_provider_identities a where not exists(select 1 from _pc_targets t where t.provider=a.provider and t.provider_player_id=a.provider_player_id)) union all (select a.* from public.nba_player_provider_identities a where not exists(select 1 from _pc_targets t where t.provider=a.provider and t.provider_player_id=a.provider_player_id) except select * from _pc_base)) then raise exception 'Baseline identity drift: re-review'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id) where (to_jsonb(a)-'created_at'-'updated_at') is distinct from (to_jsonb(t)-'created_at'-'updated_at')) then raise exception 'Target ID claimed or changed'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_targets t on a.player_id=t.player_id where a.provider_player_id<>t.provider_player_id or a.provider<>'espn') then raise exception 'Local player already mapped elsewhere'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_unresolved u on u.player_id=a.player_id) then raise exception 'Unresolved cohort changed'; end if;

  select count(*) into n from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id);
  if n not in(0,98) then raise exception 'Partial target set: do not complete an unreviewed partial application'; end if;
end $check$;
insert into public.nba_player_provider_identities(provider,provider_player_id,player_id,provider_name,resolution_status,resolution_method,evidence,is_locked)
select provider,provider_player_id,player_id,provider_name,resolution_status,resolution_method,evidence,is_locked from _pc_targets
on conflict(provider,provider_player_id) do nothing;
do $verify$ begin

  if (select count(*) from pg_trigger where tgrelid='public.nba_player_provider_identities'::regclass and not tgisinternal)<>1 or not exists(select 1 from pg_trigger where tgrelid='public.nba_player_provider_identities'::regclass and tgname='nba_provider_identity_updated_at' and tgenabled='O' and tgtype=19 and tgfoid='public.set_nba_projection_updated_at()'::regprocedure) then raise exception 'Unexpected identity triggers'; end if;
  if (select btrim(regexp_replace(prosrc,'[[:space:]]+',' ','g')) from pg_proc where oid='public.set_nba_projection_updated_at()'::regprocedure) is distinct from 'begin new.updated_at=clock_timestamp(); return new; end;' then raise exception 'Unexpected function body: set_nba_projection_updated_at'; end if;
  if (select count(*) from _pc_targets)<>98 or (select count(distinct provider_player_id) from _pc_targets)<>98 or (select count(distinct player_id) from _pc_targets)<>98 then raise exception 'Invalid target set'; end if;
  if exists ((select * from _pc_players except select id,name,nba_player_id,team_abbreviation,is_active from public.players) union all (select id,name,nba_player_id,team_abbreviation,is_active from public.players except select * from _pc_players)) then raise exception 'Player catalog drift: re-review'; end if;
  if exists ((select * from _pc_base except select a.* from public.nba_player_provider_identities a where not exists(select 1 from _pc_targets t where t.provider=a.provider and t.provider_player_id=a.provider_player_id)) union all (select a.* from public.nba_player_provider_identities a where not exists(select 1 from _pc_targets t where t.provider=a.provider and t.provider_player_id=a.provider_player_id) except select * from _pc_base)) then raise exception 'Baseline identity drift: re-review'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id) where (to_jsonb(a)-'created_at'-'updated_at') is distinct from (to_jsonb(t)-'created_at'-'updated_at')) then raise exception 'Target ID claimed or changed'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_targets t on a.player_id=t.player_id where a.provider_player_id<>t.provider_player_id or a.provider<>'espn') then raise exception 'Local player already mapped elsewhere'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_unresolved u on u.player_id=a.player_id) then raise exception 'Unresolved cohort changed'; end if;

  if (select count(*) from public.nba_player_provider_identities)<>465 or (select count(*) from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id))<>98 then raise exception 'Post-insert count mismatch'; end if;
end $verify$;
commit;
