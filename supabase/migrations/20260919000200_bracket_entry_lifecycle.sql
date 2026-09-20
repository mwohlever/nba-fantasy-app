-- Bracket Challenge entrant admission and immutable entry snapshots.
-- Forward-only: this file is intentionally not applied by Codex.
begin;

alter table public.bracket_contests
  add column if not exists managed_entrants_allowed boolean not null default true;

-- Transactional contest admission. The service verifies account ownership;
-- this function makes the contest limit authoritative under concurrent calls.
create or replace function public.admit_bracket_master_to_contest(
  p_contest_id uuid,
  p_master_bracket_id uuid
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_contest public.bracket_contests%rowtype;
  v_master public.bracket_master_brackets%rowtype;
  v_entrant public.bracket_entrants%rowtype;
  v_entry_id bigint;
  v_count integer;
begin
  select * into v_contest from public.bracket_contests where id = p_contest_id for update;
  if not found then raise exception 'Bracket contest not found.'; end if;
  select * into v_master from public.bracket_master_brackets where id = p_master_bracket_id for update;
  if not found or v_master.competition_id <> v_contest.competition_id then raise exception 'Master bracket does not match this contest.'; end if;
  select * into v_entrant from public.bracket_entrants where id = v_master.entrant_id;
  if v_entrant.entrant_kind = 'managed' and not v_contest.managed_entrants_allowed then raise exception 'Managed entrants are not allowed in this contest.'; end if;
  select id into v_entry_id from public.bracket_entries where contest_id = p_contest_id and master_bracket_id = p_master_bracket_id;
  if v_entry_id is not null then return v_entry_id; end if;
  if v_contest.status not in ('setup', 'open') or (v_contest.lock_at is not null and v_contest.lock_at <= now()) then
    raise exception 'This contest is no longer accepting brackets.';
  end if;
  select count(*) into v_count from public.bracket_entries where contest_id = p_contest_id and entrant_id = v_master.entrant_id;
  if v_count >= v_contest.max_brackets_per_entrant then raise exception 'This entrant has reached the contest bracket limit.'; end if;
  insert into public.bracket_entries (competition_id, league_id, entrant_id, contest_id, master_bracket_id, status)
  values (v_contest.competition_id, v_contest.league_id, v_master.entrant_id, v_contest.id, v_master.id, 'draft') returning id into v_entry_id;
  return v_entry_id;
end;
$$;

revoke all on function public.admit_bracket_master_to_contest(uuid, uuid) from public;
grant execute on function public.admit_bracket_master_to_contest(uuid, uuid) to service_role;

-- An immutable, idempotent full-entry snapshot. Game-level locks are evaluated
-- by the application now and can later trigger partial lock workflows without
-- changing this final historical snapshot boundary.
create or replace function public.freeze_bracket_entry(p_entry_id bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_entry public.bracket_entries%rowtype; v_contest public.bracket_contests%rowtype;
begin
  select * into v_entry from public.bracket_entries where id = p_entry_id for update;
  if not found then raise exception 'Bracket entry not found.'; end if;
  if v_entry.locked_at is not null or v_entry.status in ('locked','final') then return v_entry.id; end if;
  select * into v_contest from public.bracket_contests where id = v_entry.contest_id for update;
  if not found then raise exception 'Bracket contest not found.'; end if;
  update public.bracket_entries set status = 'locked', locked_at = now(), rules_version = v_contest.rules_version,
    rules_snapshot = v_contest.rules_snapshot,
    tiebreaker_value = (select tiebreaker_value from public.bracket_master_brackets where id = v_entry.master_bracket_id),
    picks_snapshot = coalesce((select jsonb_object_agg(game.game_key, pick.picked_team_id)
      from public.bracket_master_picks pick join public.bracket_games game on game.id = pick.game_id
      where pick.master_bracket_id = v_entry.master_bracket_id and pick.competition_id = v_entry.competition_id), '{}'::jsonb),
    updated_at = now() where id = v_entry.id;
  insert into public.bracket_picks (entry_id, competition_id, game_id, picked_team_id)
    select v_entry.id, pick.competition_id, pick.game_id, pick.picked_team_id from public.bracket_master_picks pick
    where pick.master_bracket_id = v_entry.master_bracket_id and pick.competition_id = v_entry.competition_id
    on conflict (entry_id, game_id) do nothing;
  return v_entry.id;
end;
$$;

revoke all on function public.freeze_bracket_entry(bigint) from public;
grant execute on function public.freeze_bracket_entry(bigint) to service_role;

-- Preserve the frozen identity, rules, tiebreaker, and pick snapshot while
-- leaving scoring columns on normalized bracket_picks available to later jobs.
create or replace function public.protect_frozen_bracket_entry()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and old.locked_at is not null then
    raise exception 'Frozen bracket entry snapshots are immutable.';
  end if;
  if old.locked_at is not null and (
    new.contest_id is distinct from old.contest_id or
    new.master_bracket_id is distinct from old.master_bracket_id or
    new.competition_id is distinct from old.competition_id or
    new.league_id is distinct from old.league_id or
    new.entrant_id is distinct from old.entrant_id or
    new.rules_version is distinct from old.rules_version or
    new.rules_snapshot is distinct from old.rules_snapshot or
    new.picks_snapshot is distinct from old.picks_snapshot or
    new.tiebreaker_value is distinct from old.tiebreaker_value or
    new.locked_at is distinct from old.locked_at
  ) then raise exception 'Frozen bracket entry snapshots are immutable.'; end if;
  return new;
end;
$$;

create or replace function public.protect_frozen_bracket_pick()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and exists (select 1 from public.bracket_entries where id = old.entry_id and locked_at is not null) then
    raise exception 'Frozen bracket picks are immutable.';
  end if;
  if exists (select 1 from public.bracket_entries where id = old.entry_id and locked_at is not null) and (
    new.entry_id is distinct from old.entry_id or new.competition_id is distinct from old.competition_id or
    new.game_id is distinct from old.game_id or new.picked_team_id is distinct from old.picked_team_id
  ) then raise exception 'Frozen bracket picks are immutable.'; end if;
  return new;
end;
$$;

drop trigger if exists protect_frozen_bracket_entry_trigger on public.bracket_entries;
create trigger protect_frozen_bracket_entry_trigger before update or delete on public.bracket_entries
for each row execute function public.protect_frozen_bracket_entry();
drop trigger if exists protect_frozen_bracket_pick_trigger on public.bracket_picks;
create trigger protect_frozen_bracket_pick_trigger before update or delete on public.bracket_picks
for each row execute function public.protect_frozen_bracket_pick();

comment on column public.bracket_contests.managed_entrants_allowed is 'Whether account-managed, non-login entrants may be admitted.';
commit;
