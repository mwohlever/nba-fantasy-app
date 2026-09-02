-- NBA Skins Group scope, Phase A: backward-compatible scoped uniqueness.
-- Apply before deploying the Group-scoped NBA Skins runtime.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'nba_skins_seasons_league_season_key'
      and conrelid = 'public.nba_skins_seasons'::regclass
  ) then
    alter table public.nba_skins_seasons
      add constraint nba_skins_seasons_league_season_key
      unique (league_id, season);
  end if;
end
$$;

commit;
