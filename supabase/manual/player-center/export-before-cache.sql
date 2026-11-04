\set ON_ERROR_STOP on
-- SELECT-only. Set provider_ids_json to the exact --list-targets output for this batch.
-- Use psql -X -qAt ... -v provider_ids_json='["1966"]' -f THIS_FILE > before-cache.json
begin isolation level repeatable read read only;
select coalesce(jsonb_agg(c order by c.provider_player_id),'[]'::jsonb)
from public.player_center_season_cache c
where c.sport='nba' and c.season=2027 and c.phase='regular' and c.provider='espn'
  and c.provider_player_id in(select jsonb_array_elements_text(:'provider_ids_json'::jsonb));
commit;
