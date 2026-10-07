-- Widen the existing sport constraint; preserve NFL favorites and all access controls.
begin;

alter table public.live_score_favorite_teams
  drop constraint live_score_favorite_teams_sport_check;

alter table public.live_score_favorite_teams
  add constraint live_score_favorite_teams_sport_check
  check (sport in ('nfl', 'nba'));

commit;
