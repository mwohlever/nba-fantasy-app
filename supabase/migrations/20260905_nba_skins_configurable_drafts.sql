-- NBA Skins season-level immutable draft configuration.
-- Existing seasons were created under the legacy 4 x 7 format.

begin;

alter table public.nba_skins_seasons
  add column if not exists participant_count integer,
  add column if not exists nba_teams_per_participant integer;

update public.nba_skins_seasons
set
  participant_count = coalesce(participant_count, 4),
  nba_teams_per_participant = coalesce(nba_teams_per_participant, 7)
where
  participant_count is null
  or nba_teams_per_participant is null;

alter table public.nba_skins_seasons
  alter column participant_count set default 4,
  alter column participant_count set not null,
  alter column nba_teams_per_participant set default 7,
  alter column nba_teams_per_participant set not null;

alter table public.nba_skins_seasons
  drop constraint if exists nba_skins_seasons_participant_count_check,
  drop constraint if exists nba_skins_seasons_nba_teams_per_participant_check,
  drop constraint if exists nba_skins_seasons_total_picks_check;

alter table public.nba_skins_seasons
  add constraint nba_skins_seasons_participant_count_check
    check (participant_count >= 2),
  add constraint nba_skins_seasons_nba_teams_per_participant_check
    check (nba_teams_per_participant >= 1),
  add constraint nba_skins_seasons_total_picks_check
    check (participant_count * nba_teams_per_participant <= 30);

alter table public.nba_skins_draft_order
  drop constraint if exists nba_skins_draft_order_draft_position_check;

alter table public.nba_skins_draft_order
  add constraint nba_skins_draft_order_draft_position_check
    check (draft_position >= 1);

alter table public.nba_skins_picks
  drop constraint if exists nba_skins_picks_draft_round_check;

alter table public.nba_skins_picks
  add constraint nba_skins_picks_draft_round_check
    check (draft_round is null or draft_round >= 1);

commit;
