-- Golf Best Ball Weekend Salary Cap: acquisition is open after accepted R1
-- play and before accepted R3 play.  The lifecycle writer remains the only
-- timing authority; this migration does not fabricate timestamps or rows.
begin;

create or replace function public.write_golf_lifecycle_facts(
 p_slate bigint,p_group uuid,p_league uuid,p_expected_accepted bigint,
 p_expected_periods jsonb,p_lock_reason text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v bigint; starts integer[]; p golf_roster_periods%rowtype; should_lock boolean; should_open boolean; why text;
begin
 v:=lock_golf_lifecycle(p_slate,p_group,p_league);
 if v is distinct from p_expected_accepted then raise exception 'Accepted Golf revision conflict'; end if;
 if not exists(select 1 from golf_roster_periods where slate_id=p_slate) then raise exception 'Explicit initialization required'; end if;
 if (select count(*) from golf_roster_periods where slate_id=p_slate) <>
   (select case when coalesce((rules_snapshot#>>'{rosterPeriods,type}')='split_after_round_2' and
     (not(rules_snapshot?'sport') or rules_snapshot->>'sport'='golf'),false) then 2 else 1 end from slates where id=p_slate) then
   raise exception 'Initialize complete period set'; end if;
 if jsonb_typeof(p_expected_periods) is distinct from 'object' or
    (select count(*) from jsonb_object_keys(p_expected_periods))<>(select count(*) from golf_roster_periods where slate_id=p_slate) then raise exception 'Supply all period revisions'; end if;
 if p_lock_reason is not null and p_lock_reason not in ('acquisition_deadline','commissioner_lock') then raise exception 'Invalid restrictive lock reason'; end if;
 select coalesce(array_agg(distinct r.round_number order by r.round_number),'{}'::integer[]) into starts
 from golf_rounds r join golf_event_players e on e.id=r.event_player_id
 where e.slate_id=p_slate and r.round_number between 1 and 4 and
 (r.holes_completed>0 or exists(select 1 from golf_holes h where h.round_id=r.id and h.hole_number between 1 and 18 and h.strokes>0));
 for p in select * from golf_roster_periods where slate_id=p_slate order by id loop
   if (p_expected_periods->>p.period_key)::bigint is distinct from p.revision then raise exception 'Golf period revision conflict'; end if;
   select coalesce(array_agg(distinct n order by n),'{}'::integer[]) into starts from unnest(starts||p.started_rounds) n;
 end loop;
 for p in select * from golf_roster_periods where slate_id=p_slate order by id loop
   should_lock:=p_lock_reason is not null or
     (p.period_key='weekend' and starts && array[3,4]) or
     (p.period_key in ('opening','full_tournament') and cardinality(starts)>0) or
     (p.period_key in ('opening','full_tournament') and (select is_locked from slates where id=p_slate));
   -- Only accepted R1 evidence opens Weekend, and any accepted R3 evidence
   -- prevents a late open. This also safely catches an underway R2 slate on
   -- its first normal reconciliation after deployment.
   should_open:=p.period_key='weekend' and starts && array[1] and not (starts && array[3,4])
     and p.locked_at is null and p.completed_at is null;
   why:=case when p.period_key='weekend' and starts && array[3,4] then 'round_3_started'
     when p.period_key in ('opening','full_tournament') and cardinality(starts)>0 then 'opening_play_started'
     else coalesce(p_lock_reason,'acquisition_locked') end;
   if p.started_rounds is distinct from starts or p.accepted_revision<>v or (should_lock and p.locked_at is null)
      or (should_open and p.opened_at is null) then
     update golf_roster_periods set revision=revision+1,accepted_revision=v,started_rounds=starts,
       opened_at=case when should_open then coalesce(opened_at,clock_timestamp()) else opened_at end,
       locked_at=case when should_lock then coalesce(locked_at,clock_timestamp()) else locked_at end,
       lock_reason=case when should_lock then coalesce(lock_reason,why) else lock_reason end,
       evidence_reference='accepted_state:'||v::text,
       evidence_snapshot=p.evidence_snapshot||jsonb_build_object('acceptedRevision',v,'explicitLockReason',p_lock_reason)
     where id=p.id;
   end if;
 end loop;
 return (select jsonb_agg(to_jsonb(period_row) order by period_row.id) from golf_roster_periods period_row where period_row.slate_id=p_slate);
end;
$$;

create or replace function public.save_golf_salary_cap_lineup(
  p_slate bigint,p_group uuid,p_league uuid,p_team bigint,p_actor uuid,p_period text,p_expected_lineup_revision bigint,p_player_ids bigint[]
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.slates%rowtype; period_row public.golf_roster_periods%rowtype; ps public.golf_salary_price_sets%rowtype; lineup public.golf_salary_cap_lineups%rowtype; lineup_exists boolean; roster_size integer; cap numeric(7,2); total numeric(7,2); started boolean;
begin
  s:=assert_golf_salary_cap_scope(p_slate,p_group,p_league); perform public.lock_golf_lifecycle(p_slate,p_group,p_league);
  select * into period_row from public.golf_roster_periods where slate_id=p_slate and period_key=p_period for update; if not found then raise exception 'Golf roster period is not initialized'; end if;
  select * into ps from public.golf_salary_price_sets where slate_id=p_slate for update; if not found or ps.status<>'frozen' then raise exception 'Frozen Golf salary prices required'; end if;
  if ps.rules_snapshot is distinct from s.rules_snapshot then raise exception 'Frozen salary rules mismatch'; end if;
  if (p_period<>'weekend' and s.is_locked) or period_row.locked_at is not null or period_row.completed_at is not null or period_row.opened_at is null or (period_row.evidence_snapshot->>'acquisitionDeadline' is not null and (period_row.evidence_snapshot->>'acquisitionDeadline')::timestamptz<=clock_timestamp()) then raise exception 'This Golf roster period is locked or unavailable'; end if;
  started:=exists(select 1 from public.golf_rounds r join public.golf_event_players e on e.id=r.event_player_id where e.slate_id=p_slate and ((p_period in ('full_tournament','opening') and r.round_number=1) or (p_period='weekend' and r.round_number>=3)) and (r.holes_completed>0 or exists(select 1 from public.golf_holes h where h.round_id=r.id and h.strokes>0))); if started then raise exception 'Competition play has already started for this roster period'; end if;
  if not exists(select 1 from public.teams t join public.group_memberships m on m.user_id=t.user_id and m.group_id=t.group_id and m.is_active join public.slate_teams st on st.team_id=t.id and st.slate_id=p_slate and st.is_participating where t.id=p_team and t.group_id=p_group and (t.user_id=p_actor or exists(select 1 from public.group_memberships a where a.group_id=p_group and a.user_id=p_actor and a.is_active and a.role='admin') or exists(select 1 from public.app_users a where a.id=p_actor and a.system_role='super_admin'))) then raise exception 'Unauthorized Golf participant'; end if;
  if jsonb_typeof(s.rules_snapshot#>'{roster,slots}') is distinct from 'array' or jsonb_array_length(s.rules_snapshot#>'{roster,slots}')<>1 or s.rules_snapshot#>>'{roster,slots,0,position}' is distinct from 'GOLFER' or jsonb_typeof(s.rules_snapshot#>'{roster,slots,0,slotCount}') is distinct from 'number' or jsonb_typeof(s.rules_snapshot#>'{draft,salaryCap}') is distinct from 'number' then raise exception 'Invalid frozen Golf Salary Cap rules'; end if;
  if (s.rules_snapshot#>>'{roster,slots,0,slotCount}')::numeric not between 1 and 50 or trunc((s.rules_snapshot#>>'{roster,slots,0,slotCount}')::numeric)<>(s.rules_snapshot#>>'{roster,slots,0,slotCount}')::numeric or (s.rules_snapshot#>>'{draft,salaryCap}')::numeric<=0 or trunc((s.rules_snapshot#>>'{draft,salaryCap}')::numeric)<>(s.rules_snapshot#>>'{draft,salaryCap}')::numeric then raise exception 'Invalid frozen Golf Salary Cap limits'; end if;
  roster_size:=(s.rules_snapshot#>>'{roster,slots,0,slotCount}')::integer; cap:=(s.rules_snapshot#>>'{draft,salaryCap}')::numeric(7,2);
  if p_player_ids is null or cardinality(p_player_ids)<>roster_size or exists(select 1 from unnest(p_player_ids) x where x is null) or cardinality(p_player_ids)<>(select count(distinct x) from unnest(p_player_ids) x) then raise exception 'Select exactly % unique golfers',roster_size; end if;
  if exists(select 1 from unnest(p_player_ids) x where not exists(select 1 from public.golf_event_players e where e.slate_id=p_slate and e.player_id=x)) then raise exception 'Selected golfer is outside this tournament field'; end if;
  -- Lock the exact existing team/period roster before eligibility validation.
  -- A terminal-status golfer is allowed only when this very lineup already
  -- contains that player; removing them therefore ends the exception.
  select * into lineup from public.golf_salary_cap_lineups where slate_id=p_slate and period_id=period_row.id and team_id=p_team for update;
  lineup_exists:=found;
  if p_period='weekend' and exists(select 1 from unnest(p_player_ids) x where exists(select 1 from public.golf_event_players e where e.slate_id=p_slate and e.player_id=x and e.status in ('cut','withdrawn','disqualified','did_not_start')) and not exists(select 1 from public.golf_salary_cap_lineup_players lp where lp.lineup_id=lineup.id and lp.player_id=x)) then raise exception 'Selected golfer is not eligible for the weekend roster'; end if;
  if exists(select 1 from unnest(p_player_ids) x left join public.golf_salary_prices p on p.price_set_id=ps.id and p.player_id=x where p.effective_salary is null) then raise exception 'Selected golfer does not have a frozen salary'; end if;
  select sum(p.effective_salary) into total from public.golf_salary_prices p where p.price_set_id=ps.id and p.player_id=any(p_player_ids); if total>cap then raise exception 'Lineup exceeds the $% salary cap',cap; end if;
  if lineup_exists and lineup.revision is distinct from p_expected_lineup_revision then raise exception 'Golf Salary Cap lineup changed; refresh and try again'; end if; if not lineup_exists and p_expected_lineup_revision is not null then raise exception 'Golf Salary Cap lineup changed; refresh and try again'; end if;
  if not lineup_exists then insert into public.golf_salary_cap_lineups(slate_id,group_id,league_id,period_id,price_set_id,team_id,total_salary) values(p_slate,p_group,p_league,period_row.id,ps.id,p_team,total) returning * into lineup; else update public.golf_salary_cap_lineups set total_salary=total,revision=revision+1,updated_at=clock_timestamp() where id=lineup.id returning * into lineup; end if;
  delete from public.golf_salary_cap_lineup_players where lineup_id=lineup.id; insert into public.golf_salary_cap_lineup_players(lineup_id,player_id,effective_salary) select lineup.id,p.player_id,p.effective_salary from public.golf_salary_prices p where p.price_set_id=ps.id and p.player_id=any(p_player_ids);
  return jsonb_build_object('lineupId',lineup.id,'revision',lineup.revision,'period',p_period,'playerIds',p_player_ids,'totalSalary',total);
end;
$$;

revoke all on function public.write_golf_lifecycle_facts(bigint,uuid,uuid,bigint,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.save_golf_salary_cap_lineup(bigint,uuid,uuid,bigint,uuid,text,bigint,bigint[]) from public,anon,authenticated;
grant execute on function public.write_golf_lifecycle_facts(bigint,uuid,uuid,bigint,jsonb,text) to service_role;
grant execute on function public.save_golf_salary_cap_lineup(bigint,uuid,uuid,bigint,uuid,text,bigint,bigint[]) to service_role;

commit;
