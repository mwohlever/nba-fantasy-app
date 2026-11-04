\set ON_ERROR_STOP on
-- SELECT-only. Explicit season + reviewed IDs, no writes or scoring context.
-- psql -X -qAt -v season=2026 -v provider_ids_json='["3139477"]' -f THIS_FILE > before-cache.json
begin isolation level repeatable read read only;
select coalesce(jsonb_agg(c order by c.provider_player_id),'[]'::jsonb)
from public.player_center_season_cache c
where c.sport='nfl' and c.season=:'season'::integer and c.phase='regular' and c.provider='espn'
  and c.provider_player_id in(select jsonb_array_elements_text(:'provider_ids_json'::jsonb));
commit;
