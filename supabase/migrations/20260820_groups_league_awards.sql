begin;

alter table public.league_awards
  add column if not exists league_id uuid;


do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'league_awards_league_id_fkey'
  ) then
    alter table public.league_awards
      add constraint league_awards_league_id_fkey
      foreign key (league_id)
      references public.leagues(id)
      on delete cascade;
  end if;
end
$$;


/*
 * Backfill historical awards through:
 *
 * award.team_id
 *   -> teams.group_id
 *   -> matching League sport
 *
 * Keep the legacy sport column for display/backward
 * compatibility, but League ownership is authoritative.
 */
update public.league_awards award
set league_id = (
  select league.id
  from public.teams team
  join public.leagues league
    on league.group_id = team.group_id
  where team.id = award.team_id
    and league.sport_key =
      case award.sport
        when 'nba-skins' then 'nba_skins'
        when 'ncaa' then 'ncaa_pickem'
        else award.sport
      end
  order by league.id
  limit 1
)
where award.league_id is null;


create index if not exists
  league_awards_league_season_idx
on public.league_awards (
  league_id,
  season
);


create index if not exists
  league_awards_league_team_idx
on public.league_awards (
  league_id,
  team_id
);


/*
 * Enforce League ownership once every legacy row has
 * successfully mapped. If an unexpected historical row cannot
 * map, leave the column nullable instead of breaking migration.
 */
do $$
begin
  if not exists (
    select 1
    from public.league_awards
    where league_id is null
  ) then
    alter table public.league_awards
      alter column league_id set not null;
  end if;
end
$$;

commit;
