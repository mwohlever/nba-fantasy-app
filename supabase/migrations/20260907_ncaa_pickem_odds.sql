begin;

alter table public.ncaa_pickem_games
  add column if not exists spread_favorite_team_id text,
  add column if not exists spread numeric,
  add column if not exists over_under numeric,
  add column if not exists odds_provider text,
  add column if not exists odds_updated_at timestamptz;

comment on column public.ncaa_pickem_games.spread_favorite_team_id is
  'ESPN team ID of the current betting favorite when the stored spread was captured.';

comment on column public.ncaa_pickem_games.spread is
  'Current point spread for the favorite, normally a negative number such as -2.5.';

comment on column public.ncaa_pickem_games.over_under is
  'Current game total from the ESPN scoreboard odds feed.';

comment on column public.ncaa_pickem_games.odds_provider is
  'Sportsbook/provider name supplied by ESPN for the stored odds.';

comment on column public.ncaa_pickem_games.odds_updated_at is
  'Last time pre-kickoff odds were captured from ESPN.';

commit;
