\set ON_ERROR_STOP on
-- READ ONLY, after approved DDL/population. Example: -v sport=nba -v season=2027
-- This is publication evidence, not a replacement for metric-specific authenticated API gates.
begin isolation level repeatable read read only;
with params as (select :'sport'::text as sport, :'season'::integer as season),
catalog as (
  select p.id,p.name,p.position_group as position,'nba'::text as sport,
    case when count(i.provider_player_id)=1 then min(i.provider_player_id) else null end as provider_id
  from public.players p left join public.nba_player_provider_identities i on i.player_id=p.id and i.provider='espn' and i.resolution_status='resolved'
  where p.is_active group by p.id,p.name,p.position_group
  union all
  select p.id,p.name,p.position,'nfl',p.nfl_player_id::text from public.players_nfl p where p.is_active
), scoped as (
  select p.*,c.as_of,c.checked_at,c.complete,c.expected_games,c.observed_games,c.issues,
    c.checked_at>=clock_timestamp()-interval '24 hours' and c.as_of>=clock_timestamp()-interval '24 hours' as current_check_fresh
  from catalog p cross join params x left join public.player_center_season_cache c
    on c.sport=p.sport and c.provider='espn' and c.provider_player_id=p.provider_id and c.season=x.season and c.phase='regular'
    and (case when p.sport='nba' then c.nba_local_player_id else c.nfl_local_player_id end)=p.id
  where p.sport=x.sport
)
select *,count(*) over() as active_pool_players,
 count(*) filter(where provider_id is null) over() as missing_mappings,
 count(*) filter(where complete is true and current_check_fresh is true) over() as complete_fresh_rows,
 (select count(distinct as_of) from scoped) as distinct_cutoffs
from scoped order by name,id;
-- Current-season conservative evidence. Prior-season readers use seven-day checked_at policy.
-- Missing/short/incomplete stats still require each metric/window API check, in the authorized Group/slate.
commit;
