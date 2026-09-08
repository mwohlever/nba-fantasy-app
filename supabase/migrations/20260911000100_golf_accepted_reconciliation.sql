-- MANUAL ONLY. Additive; no history is deleted or rewritten.
begin;
-- The foundation SQL excludes round_complete although the existing refresh uses it.
-- Widen only that existing check, retaining every previously permitted status.
do $$
declare existing_check text;
begin
  select pg_get_expr(conbin, conrelid) into existing_check from pg_constraint
    where conrelid = 'public.golf_event_players'::regclass
      and conname = 'golf_event_players_status_check' and contype = 'c';
  if existing_check is not null and position('round_complete' in existing_check) = 0 then
    alter table public.golf_event_players drop constraint golf_event_players_status_check;
    execute format('alter table public.golf_event_players add constraint golf_event_players_status_check check ((%s) or status = %L)', existing_check, 'round_complete');
  end if;
end;
$$;
alter table public.golf_holes add column if not exists reconciliation jsonb not null default '{}'::jsonb;
alter table public.golf_rounds add column if not exists reconciliation jsonb not null default '{}'::jsonb;
alter table public.golf_rounds add column if not exists accepted_revision bigint not null default 0;
alter table public.golf_event_players add column if not exists reconciliation jsonb not null default '{}'::jsonb;
create table public.golf_accepted_versions (
  slate_id bigint primary key references public.slates(id) on delete cascade,
  revision bigint not null default 0
);
alter table public.golf_accepted_versions enable row level security;
revoke all on public.golf_accepted_versions from public, anon, authenticated;
grant all on public.golf_accepted_versions to service_role;

-- The TypeScript reconciler supplies a calculated patch. CAS protects accepted scoring against overlapping refresh/replay writers.
-- Failure at any write rolls back golfer state AND team results. No partial scoring commits.
create or replace function public.commit_golf_reconciliation(
  p_slate_id bigint, p_expected_revision bigint,
  p_holes jsonb, p_rounds jsonb, p_events jsonb, p_teams jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_revision bigint;
begin
  if not exists (select 1 from public.slates where id = p_slate_id and sport = 'golf') then
    raise exception 'Golf slate required';
  end if;
  insert into public.golf_accepted_versions(slate_id) values(p_slate_id) on conflict do nothing;
  select revision into v_revision from public.golf_accepted_versions where slate_id = p_slate_id for update;
  if v_revision <> p_expected_revision then return jsonb_build_object('conflict', true); end if;
  if jsonb_array_length(p_holes) + jsonb_array_length(p_rounds) + jsonb_array_length(p_events) + jsonb_array_length(p_teams) = 0 then
    return jsonb_build_object('revision', v_revision);
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_holes) as h(round_id bigint)
    where not exists (select 1 from public.golf_rounds r join public.golf_event_players e on e.id=r.event_player_id where r.id=h.round_id and e.slate_id=p_slate_id)
  ) or exists (
    select 1 from jsonb_to_recordset(p_rounds) as r(id bigint)
    where not exists (select 1 from public.golf_rounds gr join public.golf_event_players e on e.id=gr.event_player_id where gr.id=r.id and e.slate_id=p_slate_id)
  ) or exists (
    select 1 from jsonb_to_recordset(p_events) as e(id bigint)
    where not exists (select 1 from public.golf_event_players ge where ge.id=e.id and ge.slate_id=p_slate_id)
  ) or exists (select 1 from jsonb_to_recordset(p_teams) as t(slate_id bigint) where t.slate_id is distinct from p_slate_id) then
    raise exception 'Golf reconciliation scope mismatch';
  end if;
  insert into public.golf_holes(round_id,hole_number,strokes,relative_to_par,score_display,reconciliation,updated_at)
    select round_id,hole_number,strokes,relative_to_par,score_display,reconciliation,now()
    from jsonb_populate_recordset(null::public.golf_holes,p_holes)
    on conflict(round_id,hole_number) do update set strokes=excluded.strokes,relative_to_par=excluded.relative_to_par,
      score_display=excluded.score_display,reconciliation=excluded.reconciliation,updated_at=excluded.updated_at;
  update public.golf_rounds t set strokes=p.strokes,score_to_par=p.score_to_par,score_display=p.score_display,holes_completed=p.holes_completed,status=p.status,tee_time=p.tee_time,tee_time_raw=p.tee_time_raw,reconciliation=p.reconciliation,accepted_revision=p.accepted_revision,updated_at=now()
    from jsonb_populate_recordset(null::public.golf_rounds,p_rounds) p where t.id=p.id;
  update public.golf_event_players t set leaderboard_order=p.leaderboard_order,official_score_to_par=p.official_score_to_par,official_score_display=p.official_score_display,penalty_strokes=p.penalty_strokes,fantasy_score=p.fantasy_score,rounds_completed=p.rounds_completed,holes_completed=p.holes_completed,current_round=p.current_round,last_hole=p.last_hole,status=p.status,tee_time=p.tee_time,tee_time_raw=p.tee_time_raw,reconciliation=p.reconciliation,updated_at=now()
    from jsonb_populate_recordset(null::public.golf_event_players,p_events) p where t.id=p.id;
  insert into public.team_slate_results(slate_id,team_id,fantasy_points,finish_position,games_completed,games_in_progress,games_remaining)
    select slate_id,team_id,fantasy_points,finish_position,games_completed,games_in_progress,games_remaining
    from jsonb_populate_recordset(null::public.team_slate_results,p_teams)
    on conflict(slate_id,team_id) do update set fantasy_points=excluded.fantasy_points,finish_position=excluded.finish_position,
      games_completed=excluded.games_completed,games_in_progress=excluded.games_in_progress,games_remaining=excluded.games_remaining;
  update public.golf_accepted_versions set revision=revision+1 where slate_id=p_slate_id returning revision into v_revision;
  return jsonb_build_object('revision', v_revision);
end;
$$;
revoke all on function public.commit_golf_reconciliation(bigint,bigint,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.commit_golf_reconciliation(bigint,bigint,jsonb,jsonb,jsonb,jsonb) to service_role;
commit;
