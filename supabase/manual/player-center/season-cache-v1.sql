\set ON_ERROR_STOP on
-- PROPOSED ADDITIVE SCHEMA ONLY. Not an automatic migration; never executed by tooling.
-- Requires its own approval, independent of mapping/ingestion approval.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$ begin
  if current_setting('sports111.rollout_approval',true) is distinct from 'schema:player-center-season-cache-v1' then raise exception 'Missing schema approval'; end if;
  if to_regclass('public.player_center_season_cache') is not null then
    if obj_description(to_regclass('public.player_center_season_cache'),'pg_class') is distinct from '111 Sports Player Center raw season cache v1' then raise exception 'Existing unreviewed relation'; end if;
    if (select count(*) from pg_attribute where attrelid=to_regclass('public.player_center_season_cache') and attnum>0 and not attisdropped)<>17 or has_table_privilege('service_role','public.player_center_season_cache','INSERT,UPDATE,DELETE') then raise exception 'Existing schema/grants changed'; end if;
  end if;
end $guard$;
create table if not exists public.player_center_season_cache (
  sport text not null check(sport in('nba','nfl')),
  provider text not null default 'espn' check(provider='espn'),
  provider_player_id text not null check(provider_player_id ~ '^[0-9]+$'),
  season integer not null check(season between 2000 and 2100),
  phase text not null check(phase='regular'),
  nba_local_player_id bigint references public.players(id) on delete restrict,
  nfl_local_player_id bigint references public.players_nfl(id) on delete restrict,
  as_of timestamptz not null,
  checked_at timestamptz not null check(checked_at>=as_of),
  expected_games integer check(expected_games between 0 and 110),
  observed_games integer not null check(observed_games between 0 and 110),
  complete boolean not null default false,
  games jsonb not null check(jsonb_typeof(games)='array'),
  season_stats jsonb,
  issues jsonb not null check(jsonb_typeof(issues)='array'),
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  rollout_batch_id text not null,
  primary key(sport,provider,provider_player_id,season,phase),
  check((sport='nba' and nba_local_player_id is not null and nfl_local_player_id is null) or (sport='nfl' and nfl_local_player_id is not null and nba_local_player_id is null)),
  check(jsonb_array_length(games)<=case when sport='nba' then 110 else 25 end),
  check(observed_games<=jsonb_array_length(games)),
  check(not complete or (expected_games is not null and observed_games=expected_games)),
  check(octet_length(games::text)<=524288),
  check(not jsonb_path_exists(games,'$[*].stats.fantasy_points'))
);
comment on table public.player_center_season_cache is '111 Sports Player Center raw season cache v1';
alter table public.player_center_season_cache enable row level security;
revoke all on public.player_center_season_cache from public,anon,authenticated,service_role;
grant select on public.player_center_season_cache to service_role;
-- Owner-only staged writes for the initial rollout. No API write grant, RPC or job is introduced.
do $verify$ begin
  if not (select relrowsecurity from pg_class where oid='public.player_center_season_cache'::regclass) then raise exception 'RLS not enabled'; end if;
  if has_table_privilege('anon','public.player_center_season_cache','SELECT') or has_table_privilege('authenticated','public.player_center_season_cache','SELECT') or has_table_privilege('service_role','public.player_center_season_cache','INSERT,UPDATE,DELETE') then raise exception 'Unexpected cache grants'; end if;
end $verify$;
commit;
