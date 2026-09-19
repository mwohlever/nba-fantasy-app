-- ============================================================
-- Bracket Challenge: fix CFP fixed-slot topology validation
--
-- Migration 004 counted bracket_games rows containing fixed seed
-- slots rather than the fixed seed slots themselves. A 12-team
-- CFP has 12 fixed slots across 8 games:
--   - 4 first-round games with two fixed seeds each
--   - 4 quarterfinals with one bye seed each
-- ============================================================

begin;

create or replace function public.replace_cfp_competition_field(
  p_competition_id bigint,
  p_teams jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competition public.bracket_competitions%rowtype;
  v_field_changed boolean;
  v_picks_cleared_count integer := 0;
  v_fixed_slot_count integer;
begin
  if jsonb_typeof(p_teams) is distinct from 'array'
    or jsonb_array_length(p_teams) <> 12 then
    raise exception 'The CFP field must contain exactly 12 teams.';
  end if;

  select *
    into v_competition
  from public.bracket_competitions
  where id = p_competition_id
  for update;

  if not found then
    raise exception 'Bracket competition not found.';
  end if;

  if v_competition.format_key <> 'cfp' then
    raise exception 'This field editor currently supports CFP competitions only.';
  end if;

  if v_competition.status <> 'setup' then
    raise exception 'The CFP field can only be changed while the competition is in setup.';
  end if;

  create temporary table cfp_field_input on commit drop as
  select
    (entry.seed)::integer as seed,
    btrim(entry.provider_team_id) as provider_team_id,
    btrim(entry.display_name) as display_name,
    nullif(btrim(entry.abbreviation), '') as abbreviation,
    nullif(btrim(entry.logo_url), '') as logo_url
  from jsonb_to_recordset(p_teams) as entry(
    seed text,
    provider_team_id text,
    display_name text,
    abbreviation text,
    logo_url text
  );

  if (select count(*) from cfp_field_input) <> 12
    or exists (
      select 1
      from cfp_field_input
      where seed not between 1 and 12
        or provider_team_id is null or provider_team_id = ''
        or display_name is null or display_name = ''
    )
    or (select count(distinct seed) from cfp_field_input) <> 12
    or (select count(distinct provider_team_id) from cfp_field_input) <> 12
    or exists (
      select 1 from generate_series(1, 12) as required_seed(seed)
      where not exists (
        select 1 from cfp_field_input input
        where input.seed = required_seed.seed
      )
    ) then
    raise exception 'The CFP field must contain unique ESPN teams for seeds 1 through 12.';
  end if;

  -- Lock the current field and graph before identity comparison/replacement.
  perform 1
  from public.bracket_competition_teams
  where competition_id = p_competition_id
  for update;

  perform 1
  from public.bracket_games
  where competition_id = p_competition_id
  for update;

  -- Count fixed seed SLOTS, not games containing fixed seed slots.
  select
    coalesce(sum(
      case
        when game.source_a_seed is not null
          and game.source_a_game_id is null
        then 1
        else 0
      end
      +
      case
        when game.source_b_seed is not null
          and game.source_b_game_id is null
        then 1
        else 0
      end
    ), 0)::integer
    into v_fixed_slot_count
  from public.bracket_games game
  where game.competition_id = p_competition_id;

  if v_fixed_slot_count <> 12
    or exists (
      select 1 from generate_series(1, 12) as required_seed(seed)
      where (
        select count(*)
        from public.bracket_games game
        where game.competition_id = p_competition_id
          and (
            (game.source_a_seed = required_seed.seed and game.source_a_game_id is null)
            or (game.source_b_seed = required_seed.seed and game.source_b_game_id is null)
          )
      ) <> 1
    ) then
    raise exception 'The persisted CFP topology does not expose exactly one fixed slot for seeds 1 through 12.';
  end if;

  select exists (
    (select seed, provider_team_id
      from public.bracket_competition_teams
      where competition_id = p_competition_id
      except
      select seed, provider_team_id from cfp_field_input)
    union all
    (select seed, provider_team_id from cfp_field_input
      except
      select seed, provider_team_id
      from public.bracket_competition_teams
      where competition_id = p_competition_id)
  ) into v_field_changed;

  -- Delete then insert is safe inside this transaction and permits seed swaps
  -- without transiently violating the provider-team unique constraint.
  delete from public.bracket_competition_teams
  where competition_id = p_competition_id;

  insert into public.bracket_competition_teams (
    competition_id, seed, provider, provider_team_id, display_name,
    abbreviation, logo_url, metadata
  )
  select
    p_competition_id, seed, 'espn', provider_team_id, display_name,
    abbreviation, logo_url, '{}'::jsonb
  from cfp_field_input
  order by seed;

  -- Only direct seed sources move. Winner/dependency graph edges remain untouched.
  update public.bracket_games game
  set source_a_team_id = field.provider_team_id,
      updated_at = clock_timestamp()
  from cfp_field_input field
  where game.competition_id = p_competition_id
    and game.source_a_seed = field.seed
    and game.source_a_game_id is null;

  update public.bracket_games game
  set source_b_team_id = field.provider_team_id,
      updated_at = clock_timestamp()
  from cfp_field_input field
  where game.competition_id = p_competition_id
    and game.source_b_seed = field.seed
    and game.source_b_game_id is null;

  if v_field_changed then
    with deleted as (
      delete from public.bracket_master_picks pick
      using public.bracket_master_brackets master
      where master.id = pick.master_bracket_id
        and master.competition_id = p_competition_id
        and master.status = 'draft'
      returning pick.id
    )
    select count(*) into v_picks_cleared_count from deleted;
  end if;

  return jsonb_build_object(
    'success', true,
    'fieldChanged', v_field_changed,
    'picksClearedCount', v_picks_cleared_count
  );
end;
$$;

revoke all on function public.replace_cfp_competition_field(bigint, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.replace_cfp_competition_field(bigint, jsonb)
  to service_role;

commit;
