-- NBA Skins Group scope, Phase B: post-deploy cleanup.
-- Apply only after the Group-scoped NBA Skins runtime is live.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'nba_skins_seasons_league_season_key'
      and conrelid = 'public.nba_skins_seasons'::regclass
  ) then
    raise exception
      'Cannot finish NBA Skins Group scope: Phase A scoped uniqueness is missing.';
  end if;

  if exists (
    select 1
    from public.nba_skins_seasons
    where league_id is null
  ) then
    raise exception
      'Cannot finish NBA Skins Group scope: seasons with null league_id remain.';
  end if;
end
$$;

alter table public.nba_skins_seasons
  alter column league_id set not null;

alter table public.nba_skins_seasons
  drop constraint if exists nba_skins_seasons_season_key;

drop trigger if exists
  nba_skins_seasons_assign_legacy_111_league
on public.nba_skins_seasons;

drop function if exists
  public.assign_legacy_111_nba_skins_league();

commit;
