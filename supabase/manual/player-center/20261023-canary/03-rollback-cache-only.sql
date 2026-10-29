\set ON_ERROR_STOP on
-- REVIEW ONLY. Requires separate production approval. No script in this bundle executes SQL.
begin;
set local search_path=pg_catalog,pg_temp,public;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$ begin
  if current_setting('sports111.rollout_approval',true) is distinct from 'rollback-cache:8819533d6b20f6f38b5f6cc7f0f597ad5b2b131735cc59064da2ad31650bb7bc' then
    raise exception 'Missing exact reviewed operation approval';
  end if;
  if current_setting('sports111.backup_receipt',true) is distinct from '6b366f6fc336bd0f69c49aa12285d55dffa8b8bbbec600dc16dde0e0a1c4d6c1' then
    raise exception 'Missing reviewed backup receipt';
  end if;
end $guard$;
lock table public.player_center_season_cache in share row exclusive mode;
\ir 00-batch-inputs.sql
do $check$ begin
  if exists(select 1 from public.player_center_season_cache a join _pc_cache s on a.sport=s.sport and a.provider=s.provider and a.provider_player_id=s.provider_player_id and a.season=s.season and a.phase=s.phase where to_jsonb(a) is distinct from to_jsonb(s)) then raise exception 'Cache changed after this batch; review the newer publication first'; end if;
end $check$;
delete from public.player_center_season_cache a using _pc_cache s where a.sport=s.sport and a.provider=s.provider and a.provider_player_id=s.provider_player_id and a.season=s.season and a.phase=s.phase and to_jsonb(a)=to_jsonb(s);
do $verify$ begin
  if exists(select 1 from public.player_center_season_cache a join _pc_cache s on a.sport=s.sport and a.provider=s.provider and a.provider_player_id=s.provider_player_id and a.season=s.season and a.phase=s.phase) then raise exception 'Cache withdrawal failed'; end if;
end $verify$;
-- Withdraw derived publication. Do not republish an older complete cache over newer facts.
-- Before images remain in the manifest/receipt for separately reviewed revalidation/restoration.
-- Immutable observation versions are retained. No trigger is disabled.
commit;
