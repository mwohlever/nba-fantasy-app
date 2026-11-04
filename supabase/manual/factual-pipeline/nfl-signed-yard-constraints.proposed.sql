-- PROPOSAL ONLY. NOT a migration runner input. Never executed by the application.
-- Separate schema approval and restored-copy rehearsal are required.
-- This does not enable the currently quarantined signed-yard writer path.
begin;
set local search_path = pg_catalog, public;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

do $guard$
declare field text; relation regclass := to_regclass('public.nfl_player_game_observation_versions'); attribute smallint;
begin
  if current_setting('sports111.factual_schema_approval', true) is distinct from 'reviewed:nfl_signed_yards_v1' then
    raise exception 'Separate reviewed NFL signed-yard schema approval required';
  end if;
  if relation is null then raise exception 'Missing reviewed NFL observation relation'; end if;
  -- Hold the same lock ALTER TABLE requires while checking its exact preconditions.
  lock table public.nfl_player_game_observation_versions in access exclusive mode;
  if not (select relrowsecurity from pg_class where oid=relation) or
    not exists(select 1 from pg_trigger where tgrelid=relation and tgname='nfl_observation_versions_immutable'
      and tgenabled='O' and tgfoid='public.reject_nfl_projection_observation_version_mutation()'::regprocedure) then
    raise exception 'NFL observation protection changed';
  end if;
  foreach field in array array['passing_yards','rushing_yards','receiving_yards'] loop
    select attnum into attribute from pg_attribute where attrelid=relation and attname=field
      and atttypid='pg_catalog.int4'::regtype and not attisdropped;
    if attribute is null or (select count(*) from pg_constraint where conrelid=relation and contype='c' and attribute=any(conkey))<>1 or
      not exists(select 1 from pg_constraint where conrelid=relation and contype='c' and convalidated
        and conname='nfl_player_game_observation_versions_'||field||'_check'
        and lower(regexp_replace(pg_get_expr(conbin,conrelid),'[[:space:]()]','','g'))=field||'isnullor'||field||'>=0') then
      raise exception 'Unreviewed type/check for %; do not broaden unexpected constraints',field;
    end if;
  end loop;
end
$guard$;

-- Integer types already bound signed values to int32. Counts/TD/LOST constraints
-- remain nonnegative. No history row, hash, view, trigger, grant or NBA RPC changes.
alter table public.nfl_player_game_observation_versions
  drop constraint nfl_player_game_observation_versions_passing_yards_check,
  drop constraint nfl_player_game_observation_versions_rushing_yards_check,
  drop constraint nfl_player_game_observation_versions_receiving_yards_check;

-- No data backfill. Existing nulls require separately approved new factual versions.
-- A reversal-safe writer/capability and local quarantine removal require another review.
commit;
