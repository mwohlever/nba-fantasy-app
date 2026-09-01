begin;

alter table public.ncaa_pickem_games
  add column if not exists commissioner_selected boolean not null default false;

alter table public.ncaa_pickem_weeks
  add constraint ncaa_pickem_weeks_league_season_week_key
  unique (league_id, season, week_number);

alter table public.ncaa_pickem_games
  add constraint ncaa_pickem_games_week_event_key
  unique (week_id, espn_event_id);

comment on column public.ncaa_pickem_games.commissioner_selected is
  'True only when a Group commissioner explicitly adds an optional game. included is derived from current AP eligibility or this flag.';

commit;
