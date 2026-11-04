\set ON_ERROR_STOP on
-- Empty-cache schema rollback only. Never deletes cache/history records to force a drop.
begin;
set local lock_timeout='3s';
do $guard$ begin
  if current_setting('sports111.rollout_approval',true) is distinct from 'rollback-schema:player-center-season-cache-v1' then raise exception 'Missing schema rollback approval'; end if;
  if to_regclass('public.player_center_season_cache') is not null then
    if obj_description('public.player_center_season_cache'::regclass,'pg_class') is distinct from '111 Sports Player Center raw season cache v1' then raise exception 'Unreviewed relation'; end if;
    lock table public.player_center_season_cache in access exclusive mode;
    if exists(select 1 from public.player_center_season_cache) then raise exception 'Cache is populated: preserve data and review a separate rollback'; end if;
  end if;
end $guard$;
drop table if exists public.player_center_season_cache restrict;
commit;
