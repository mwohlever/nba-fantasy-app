begin;

do $$
begin
  if exists (
    select 1
    from public.ncaa_pickem_weeks
    where league_id is null
  ) then
    raise exception
      'Cannot complete NCAA Pick''Em Group scoping: at least one week has no league_id.';
  end if;
end
$$;

alter table public.ncaa_pickem_weeks
  alter column league_id set not null;

alter table public.ncaa_pickem_weeks
  drop constraint if exists ncaa_pickem_weeks_season_week_key;

alter table public.ncaa_pickem_games
  drop constraint if exists ncaa_pickem_games_espn_event_id_key;

commit;
