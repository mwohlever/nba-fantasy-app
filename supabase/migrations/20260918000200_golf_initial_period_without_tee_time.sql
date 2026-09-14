-- Allow the initial Golf acquisition period to open before provider tee times
-- are available. Weekend still requires authoritative post-cut evidence and
-- a future acquisition deadline.
begin;

create or replace function public.confirm_golf_period_history(
  p_slate bigint,
  p_group uuid,
  p_league uuid,
  p_actor uuid,
  p_period text,
  p_expected_accepted bigint,
  p_expected_period bigint,
  p_action text,
  p_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v bigint;
  p golf_roster_periods%rowtype;
  t timestamptz;
begin
  v:=lock_golf_lifecycle(p_slate,p_group,p_league);

  if v is distinct from p_expected_accepted then
    raise exception 'Accepted Golf revision conflict';
  end if;

  if not exists(
    select 1
    from app_users a
    where a.id=p_actor
      and a.is_active
      and (
        a.system_role='super_admin'
        or exists(
          select 1
          from group_memberships m
          where m.user_id=a.id
            and m.group_id=p_group
            and m.is_active
            and m.role='admin'
        )
      )
  ) then
    raise exception 'Group commissioner review required';
  end if;

  select *
  into p
  from golf_roster_periods
  where slate_id=p_slate
    and period_key=p_period;

  if not found or p.revision is distinct from p_expected_period then
    raise exception 'Golf period revision conflict';
  end if;

  -- Deadline evaluation must use time AFTER any serialization wait.
  t:=clock_timestamp();

  if jsonb_typeof(p_evidence) is distinct from 'object'
    or coalesce(length(trim(p_evidence->>'sourceReference')),0)=0
    or (p_evidence->>'observedAt') is null
    or not isfinite((p_evidence->>'observedAt')::timestamptz)
    or (p_evidence->>'observedAt')::timestamptz>t
  then
    raise exception 'Reviewed evidence required';
  end if;

  if p_action='opened' then
    -- The legacy slate lock represents the opening acquisition boundary.
    -- It must not make the independent post-cut weekend period impossible
    -- to open.
    if p.locked_at is not null
      or p.completed_at is not null
      or (
        p.period_key<>'weekend'
        and (select is_locked from slates where id=p_slate)
      )
    then
      raise exception 'Acquisition closed';
    end if;

    -- Positive accepted play dominates a stale reviewed pre-start assertion.
    if exists(
      select 1
      from golf_rounds r
      join golf_event_players e on e.id=r.event_player_id
      where e.slate_id=p_slate
        and r.round_number between 1 and 4
        and (p_period<>'weekend' or r.round_number>=3)
        and (
          r.holes_completed>0
          or exists(
            select 1
            from golf_holes h
            where h.round_id=r.id
              and h.strokes>0
          )
        )
    )
      or (
        p_period='weekend'
        and p.started_rounds && array[3,4]
      )
      or (
        p_period<>'weekend'
        and cardinality(p.started_rounds)>0
      )
    then
      raise exception 'Competition play started';
    end if;

    if coalesce((p_evidence->>'tournamentComplete')::boolean,true) then
      raise exception 'Tournament must be active or upcoming';
    end if;

    -- Initial/full acquisition may open before provider tee times exist.
    -- If a deadline IS supplied, it still must be a valid future timestamp.
    if p_period<>'weekend'
      and (p_evidence->>'acquisitionDeadline') is not null
      and (
        not isfinite((p_evidence->>'acquisitionDeadline')::timestamptz)
        or (p_evidence->>'acquisitionDeadline')::timestamptz<=t
      )
    then
      raise exception 'Acquisition deadline must be in the future';
    end if;

    -- Weekend remains stricter: it requires an explicit future deadline
    -- plus exhaustive authoritative post-cut evidence.
    if p_period='weekend' then
      if (p_evidence->>'acquisitionDeadline') is null
        or not isfinite((p_evidence->>'acquisitionDeadline')::timestamptz)
        or (p_evidence->>'acquisitionDeadline')::timestamptz<=t
      then
        raise exception 'Explicit future acquisition deadline required';
      end if;

      if not coalesce((p_evidence->>'round2Complete')::boolean,false)
        or not coalesce((p_evidence->>'round3NotStarted')::boolean,false)
        or coalesce((p_evidence->>'regulationRoundCount')::integer,0) not in (3,4)
        or coalesce(p_evidence->>'cut','unknown') not in ('confirmed','no_cut')
        or not coalesce((p_evidence->>'fieldComplete')::boolean,false)
        or jsonb_typeof(p_evidence->'players') is distinct from 'array'
      then
        raise exception 'Weekend confirmation incomplete';
      end if;

      if jsonb_array_length(p_evidence->'players')=0
        or exists(
          select 1
          from jsonb_array_elements(p_evidence->'players') x
          where coalesce(x->>'eligibility','unknown') not in (
            'made_cut',
            'continuing',
            'missed_cut',
            'withdrawn',
            'disqualified',
            'did_not_start'
          )
          or not exists(
            select 1
            from golf_event_players e
            where e.slate_id=p_slate
              and e.player_id=(x->>'playerId')::bigint
          )
        )
        or (
          select count(distinct (x->>'playerId')::bigint)
          from jsonb_array_elements(p_evidence->'players') x
        ) <> jsonb_array_length(p_evidence->'players')
        or exists(
          select 1
          from golf_event_players e
          where e.slate_id=p_slate
            and not exists(
              select 1
              from jsonb_array_elements(p_evidence->'players') x
              where (x->>'playerId')::bigint=e.player_id
            )
        )
      then
        raise exception 'Exhaustive classified field required';
      end if;
    end if;

  elsif p_action='completed' then
    if not coalesce((p_evidence->>'tournamentComplete')::boolean,false)
      and not (
        p_period='opening'
        and coalesce((p_evidence->>'round2Complete')::boolean,false)
      )
    then
      raise exception 'Completion confirmation required';
    end if;

  else
    raise exception 'Unknown history action';
  end if;

  -- Repeated confirmations preserve first timestamps; no unlock/reset.
  update golf_roster_periods
  set
    revision=revision+1,
    accepted_revision=v,
    opened_at=case
      when p_action='opened' then coalesce(opened_at,t)
      else opened_at
    end,
    completed_at=case
      when p_action='completed' then coalesce(completed_at,t)
      else completed_at
    end,
    locked_at=case
      when p_action='completed' then coalesce(locked_at,t)
      else locked_at
    end,
    lock_reason=case
      when p_action='completed' then coalesce(lock_reason,'confirmed_completion')
      else lock_reason
    end,
    evidence_reference=p_evidence->>'sourceReference',
    evidence_snapshot=p_evidence||jsonb_build_object(
      'reviewedBy',p_actor,
      'action',p_action
    )
  where id=p.id
  returning * into p;

  return to_jsonb(p);
end;
$$;

revoke all on function public.confirm_golf_period_history(
  bigint,uuid,uuid,uuid,text,bigint,bigint,text,jsonb
) from public,anon,authenticated,service_role;

grant execute on function public.confirm_golf_period_history(
  bigint,uuid,uuid,uuid,text,bigint,bigint,text,jsonb
) to service_role;


create or replace function public.review_golf_salary_prices(
  p_slate bigint,
  p_group uuid,
  p_league uuid,
  p_actor uuid,
  p_action text,
  p_expected_revision bigint,
  p_overrides jsonb default '[]',
  p_acknowledge_unpriced boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  s slates%rowtype;
  ps golf_salary_price_sets%rowtype;
  item jsonb;
  salary integer;
  period_row golf_roster_periods%rowtype;
  deadline timestamptz;
  accepted_revision bigint;
  frozen_result jsonb;
begin
  s:=assert_golf_salary_cap_scope(p_slate,p_group,p_league);

  perform lock_golf_lifecycle(p_slate,p_group,p_league);

  if not exists(
    select 1
    from app_users a
    where a.id=p_actor
      and a.is_active
      and (
        a.system_role='super_admin'
        or exists(
          select 1
          from group_memberships m
          where m.user_id=a.id
            and m.group_id=p_group
            and m.is_active
            and m.role='admin'
        )
      )
  ) then
    raise exception 'Group commissioner required';
  end if;

  select *
  into ps
  from golf_salary_price_sets
  where slate_id=p_slate
  for update;

  if not found then
    raise exception 'Generate salaries first';
  end if;

  if ps.status='frozen' then
    raise exception 'Frozen Golf salaries are immutable';
  end if;

  if ps.revision is distinct from p_expected_revision then
    raise exception 'Salary review changed; reload and try again';
  end if;

  if ps.rules_snapshot is distinct from s.rules_snapshot then
    raise exception 'Frozen rules mismatch';
  end if;

  if s.is_locked
    or exists(
      select 1
      from golf_roster_periods
      where slate_id=p_slate
        and period_key<>'weekend'
        and (
          locked_at is not null
          or completed_at is not null
          or cardinality(started_rounds)>0
          or (
            evidence_snapshot->>'acquisitionDeadline' is not null
            and (evidence_snapshot->>'acquisitionDeadline')::timestamptz<=clock_timestamp()
          )
        )
    )
    or exists(
      select 1
      from golf_rounds r
      join golf_event_players e on e.id=r.event_player_id
      where e.slate_id=p_slate
        and (
          r.holes_completed>0
          or exists(
            select 1
            from golf_holes h
            where h.round_id=r.id
              and h.strokes>0
          )
        )
    )
  then
    raise exception 'Salary setup is locked';
  end if;

  if p_action='override' then
    if jsonb_typeof(p_overrides) is distinct from 'array' then
      raise exception 'Override list required';
    end if;

    if (
      select count(*)
      from jsonb_array_elements(p_overrides)
    ) <> (
      select count(distinct x->>'playerId')
      from jsonb_array_elements(p_overrides) x
    )
    then
      raise exception 'Duplicate override';
    end if;

    for item in
      select *
      from jsonb_array_elements(p_overrides)
    loop
      if item->'salary' is distinct from 'null'::jsonb
        and (
          jsonb_typeof(item->'salary') is distinct from 'number'
          or (item->>'salary')::numeric<>trunc((item->>'salary')::numeric)
        )
      then
        raise exception 'Salary must be a whole dollar amount';
      end if;

      salary:=(item->>'salary')::integer;

      if salary is not null
        and salary not between 10 and 42
      then
        raise exception 'Salary must be $10 through $42';
      end if;

      if not exists(
        select 1
        from golf_salary_prices
        where price_set_id=ps.id
          and player_id=(item->>'playerId')::bigint
          and value_basis<>'unsupported'
          and (
            not is_amateur
            or coalesce(salary,10)=10
          )
      )
      then
        raise exception 'Unsupported golfer or invalid amateur override';
      end if;

      update golf_salary_prices
      set override_salary=salary
      where price_set_id=ps.id
        and player_id=(item->>'playerId')::bigint;
    end loop;

    update golf_salary_price_sets
    set revision=revision+1
    where id=ps.id
    returning * into ps;

    return jsonb_build_object(
      'status',ps.status,
      'revision',ps.revision
    );

  elsif p_action='freeze' then

    if exists(
      select 1
      from golf_salary_prices p
      where p.price_set_id=ps.id
        and not exists(
          select 1
          from golf_event_players e
          where e.slate_id=p_slate
            and e.player_id=p.player_id
        )
    )
      or exists(
        select 1
        from golf_event_players e
        where e.slate_id=p_slate
          and not exists(
            select 1
            from golf_salary_prices p
            where p.price_set_id=ps.id
              and p.player_id=e.player_id
          )
      )
    then
      raise exception 'Price board does not match the tournament field';
    end if;

    if exists(
      select 1
      from golf_salary_prices
      where price_set_id=ps.id
        and is_amateur
        and coalesce(override_salary,suggested_salary) is distinct from 10
    )
    then
      raise exception 'Amateurs must remain $10';
    end if;

    if exists(
      select 1
      from golf_salary_prices
      where price_set_id=ps.id
        and value_basis='unsupported'
    )
      and not coalesce(p_acknowledge_unpriced,false)
    then
      raise exception 'Acknowledge that unsupported golfers remain unpriced and unavailable';
    end if;

    select *
    into period_row
    from golf_roster_periods
    where slate_id=p_slate
      and period_key=case
        when s.rules_snapshot#>>'{rosterPeriods,type}'='split_after_round_2'
          then 'opening'
        else 'full_tournament'
      end
    for update;

    if not found then
      raise exception 'Initialize Golf lifecycle before freezing';
    end if;

    if period_row.opened_at is null then
      -- Tee times improve the deadline evidence when available, but lack of
      -- provider tee times must not prevent participants from building lineups.
      select min(tee_time)
      into deadline
      from golf_event_players
      where slate_id=p_slate
        and tee_time>clock_timestamp();
    end if;

    frozen_result:=freeze_golf_salary_price_set(
      p_slate,
      p_group,
      p_league,
      p_actor
    );

    if period_row.opened_at is null then
      select revision
      into accepted_revision
      from golf_accepted_versions
      where slate_id=p_slate;

      perform confirm_golf_period_history(
        p_slate,
        p_group,
        p_league,
        p_actor,
        period_row.period_key,
        accepted_revision,
        period_row.revision,
        'opened',
        jsonb_build_object(
          'sourceReference',
            case
              when deadline is null
                then 'commissioner:salary_freeze_before_tee_times'
              else 'golf_event_players:earliest_tee_time'
            end,
          'observedAt',clock_timestamp(),
          'tournamentComplete',false,
          'acquisitionDeadline',deadline
        )
      );
    end if;

    return frozen_result;
  end if;

  raise exception 'Unknown salary review action';
end;
$$;

revoke all on function public.review_golf_salary_prices(
  bigint,uuid,uuid,uuid,text,bigint,jsonb,boolean
) from public,anon,authenticated;

grant execute on function public.review_golf_salary_prices(
  bigint,uuid,uuid,uuid,text,bigint,jsonb,boolean
) to service_role;

commit;
