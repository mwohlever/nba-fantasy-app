-- Manual application only. Preserve existing whole-dollar values as exact .00
-- amounts, then use numeric arithmetic for all persisted Salary Cap totals.
begin;

alter table public.golf_salary_prices
  alter column suggested_salary type numeric(7,2) using suggested_salary::numeric(7,2),
  alter column override_salary type numeric(7,2) using override_salary::numeric(7,2),
  alter column effective_salary type numeric(7,2) using effective_salary::numeric(7,2);
alter table public.golf_salary_cap_lineups
  alter column total_salary type numeric(7,2) using total_salary::numeric(7,2);
alter table public.golf_salary_cap_lineup_players
  alter column effective_salary type numeric(7,2) using effective_salary::numeric(7,2);

create or replace function public.create_golf_salary_price_set(
  p_slate bigint,p_group uuid,p_league uuid,p_actor uuid,p_prices jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.slates%rowtype; ps public.golf_salary_price_sets%rowtype; v_count integer; expected integer;
begin
  s:=assert_golf_salary_cap_scope(p_slate,p_group,p_league);
  if not exists(select 1 from public.app_users a where a.id=p_actor and a.is_active and
    (a.system_role='super_admin' or exists(select 1 from public.group_memberships m where m.group_id=p_group and m.user_id=a.id and m.is_active and m.role='admin'))) then
    raise exception 'Group commissioner required';
  end if;
  if s.is_locked then raise exception 'Golf slate is locked'; end if;
  if jsonb_typeof(p_prices) is distinct from 'array' or jsonb_array_length(p_prices)=0 then raise exception 'Generated price entries required'; end if;
  select * into ps from public.golf_salary_price_sets where slate_id=p_slate for update;
  if found then
    if ps.status='frozen' then raise exception 'Golf salary prices are already frozen'; end if;
    raise exception 'Generated price set already exists; freeze or remove it through reviewed administration';
  end if;
  select count(*) into expected from public.golf_event_players where slate_id=p_slate;
  if expected=0 then raise exception 'Authoritative Golf tournament field required'; end if;
  select count(*) into v_count from jsonb_to_recordset(p_prices) x(player_id bigint,suggested_salary numeric,is_amateur boolean,value_basis text,value_version text);
  if v_count<>expected or (select count(distinct x.player_id) from jsonb_to_recordset(p_prices) x(player_id bigint,suggested_salary numeric,is_amateur boolean,value_basis text,value_version text))<>expected
    or exists(select 1 from jsonb_to_recordset(p_prices) x(player_id bigint,suggested_salary numeric,is_amateur boolean,value_basis text,value_version text)
      where x.player_id is null or not exists(select 1 from public.golf_event_players e where e.slate_id=p_slate and e.player_id=x.player_id)
        or x.value_basis not in ('blended','v1_only','owgr_only','unsupported','amateur')
        or coalesce(nullif(trim(x.value_version),''),'')=''
        or (x.suggested_salary is not null and x.suggested_salary<>round(x.suggested_salary,2))
        or (x.value_basis='unsupported' and x.suggested_salary is not null)
        or (x.value_basis<>'unsupported' and (x.suggested_salary is null or x.suggested_salary not between 10 and 42))
        or (coalesce(x.is_amateur,false) and (x.suggested_salary<>10 or x.value_basis<>'amateur')))
  then raise exception 'Generated price set does not exactly match the authoritative field'; end if;
  insert into public.golf_salary_price_sets(slate_id,group_id,league_id,rules_snapshot,status,generated_by)
    values(p_slate,p_group,p_league,s.rules_snapshot,'generated',p_actor) returning * into ps;
  insert into public.golf_salary_prices(price_set_id,player_id,suggested_salary,is_amateur,value_basis,value_version)
    select ps.id,x.player_id,x.suggested_salary::numeric(7,2),coalesce(x.is_amateur,false),x.value_basis,x.value_version
    from jsonb_to_recordset(p_prices) x(player_id bigint,suggested_salary numeric,is_amateur boolean,value_basis text,value_version text);
  return jsonb_build_object('priceSetId',ps.id,'status',ps.status,'revision',ps.revision);
end;
$$;

create or replace function public.review_golf_salary_prices(
  p_slate bigint,p_group uuid,p_league uuid,p_actor uuid,p_action text,p_expected_revision bigint,
  p_overrides jsonb default '[]',p_acknowledge_unpriced boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s slates%rowtype; ps golf_salary_price_sets%rowtype; item jsonb; salary numeric(7,2); period_row golf_roster_periods%rowtype; deadline timestamptz; accepted_revision bigint; frozen_result jsonb;
begin
  s:=assert_golf_salary_cap_scope(p_slate,p_group,p_league); perform lock_golf_lifecycle(p_slate,p_group,p_league);
  if not exists(select 1 from app_users a where a.id=p_actor and a.is_active and (a.system_role='super_admin' or exists(select 1 from group_memberships m where m.user_id=a.id and m.group_id=p_group and m.is_active and m.role='admin'))) then raise exception 'Group commissioner required'; end if;
  select * into ps from golf_salary_price_sets where slate_id=p_slate for update;
  if not found then raise exception 'Generate salaries first'; end if;
  if ps.status='frozen' then raise exception 'Frozen Golf salaries are immutable'; end if;
  if ps.revision is distinct from p_expected_revision then raise exception 'Salary review changed; reload and try again'; end if;
  if ps.rules_snapshot is distinct from s.rules_snapshot then raise exception 'Frozen rules mismatch'; end if;
  if s.is_locked or exists(select 1 from golf_roster_periods where slate_id=p_slate and period_key<>'weekend' and (locked_at is not null or completed_at is not null or cardinality(started_rounds)>0 or (evidence_snapshot->>'acquisitionDeadline' is not null and (evidence_snapshot->>'acquisitionDeadline')::timestamptz<=clock_timestamp()))) or exists(select 1 from golf_rounds r join golf_event_players e on e.id=r.event_player_id where e.slate_id=p_slate and (r.holes_completed>0 or exists(select 1 from golf_holes h where h.round_id=r.id and h.strokes>0))) then raise exception 'Salary setup is locked'; end if;
  if p_action='override' then
    if jsonb_typeof(p_overrides) is distinct from 'array' then raise exception 'Override list required'; end if;
    if (select count(*) from jsonb_array_elements(p_overrides))<>(select count(distinct x->>'playerId') from jsonb_array_elements(p_overrides) x) then raise exception 'Duplicate override'; end if;
    for item in select * from jsonb_array_elements(p_overrides) loop
      if item->'salary' is distinct from 'null'::jsonb and (jsonb_typeof(item->'salary') is distinct from 'number' or (item->>'salary')::numeric<>round((item->>'salary')::numeric,2)) then raise exception 'Salary must have no more than two decimal places'; end if;
      salary:=(item->>'salary')::numeric(7,2);
      if salary is not null and salary not between 10 and 42 then raise exception 'Salary must be $10.00 through $42.00'; end if;
      if not exists(select 1 from golf_salary_prices where price_set_id=ps.id and player_id=(item->>'playerId')::bigint and value_basis<>'unsupported' and (not is_amateur or coalesce(salary,10)=10)) then raise exception 'Unsupported golfer or invalid amateur override'; end if;
      update golf_salary_prices set override_salary=salary where price_set_id=ps.id and player_id=(item->>'playerId')::bigint;
    end loop;
    update golf_salary_price_sets set revision=revision+1 where id=ps.id returning * into ps;
    return jsonb_build_object('status',ps.status,'revision',ps.revision);
  elsif p_action='freeze' then
    if exists(select 1 from golf_salary_prices p where p.price_set_id=ps.id and not exists(select 1 from golf_event_players e where e.slate_id=p_slate and e.player_id=p.player_id)) or exists(select 1 from golf_event_players e where e.slate_id=p_slate and not exists(select 1 from golf_salary_prices p where p.price_set_id=ps.id and p.player_id=e.player_id)) then raise exception 'Price board does not match the tournament field'; end if;
    if exists(select 1 from golf_salary_prices where price_set_id=ps.id and is_amateur and coalesce(override_salary,suggested_salary) is distinct from 10) then raise exception 'Amateurs must remain $10'; end if;
    if exists(select 1 from golf_salary_prices where price_set_id=ps.id and value_basis='unsupported') and not coalesce(p_acknowledge_unpriced,false) then raise exception 'Acknowledge that unsupported golfers remain unpriced and unavailable'; end if;
    select * into period_row from golf_roster_periods where slate_id=p_slate and period_key=case when s.rules_snapshot#>>'{rosterPeriods,type}'='split_after_round_2' then 'opening' else 'full_tournament' end for update;
    if not found then raise exception 'Initialize Golf lifecycle before freezing'; end if;
    if period_row.opened_at is null then select min(tee_time) into deadline from golf_event_players where slate_id=p_slate and tee_time>clock_timestamp(); end if;
    frozen_result:=freeze_golf_salary_price_set(p_slate,p_group,p_league,p_actor);
    if period_row.opened_at is null then select revision into accepted_revision from golf_accepted_versions where slate_id=p_slate; perform confirm_golf_period_history(p_slate,p_group,p_league,p_actor,period_row.period_key,accepted_revision,period_row.revision,'opened',jsonb_build_object('sourceReference',case when deadline is null then 'commissioner:salary_freeze_before_tee_times' else 'golf_event_players:earliest_tee_time' end,'observedAt',clock_timestamp(),'tournamentComplete',false,'acquisitionDeadline',deadline)); end if;
    return frozen_result;
  end if;
  raise exception 'Unknown salary review action';
end;
$$;

create or replace function public.save_golf_salary_cap_lineup(
  p_slate bigint,p_group uuid,p_league uuid,p_team bigint,p_actor uuid,p_period text,p_expected_lineup_revision bigint,p_player_ids bigint[]
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.slates%rowtype; period_row public.golf_roster_periods%rowtype; ps public.golf_salary_price_sets%rowtype; lineup public.golf_salary_cap_lineups%rowtype; roster_size integer; cap numeric(7,2); total numeric(7,2); started boolean;
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
  if p_period='weekend' and (jsonb_typeof(period_row.evidence_snapshot->'players') is distinct from 'array' or exists(select 1 from unnest(p_player_ids) x where not exists(select 1 from jsonb_array_elements(period_row.evidence_snapshot->'players') q where (q->>'playerId')::bigint=x and q->>'eligibility' in ('made_cut','continuing')))) then raise exception 'Selected golfer is not eligible for the weekend roster'; end if;
  if exists(select 1 from unnest(p_player_ids) x left join public.golf_salary_prices p on p.price_set_id=ps.id and p.player_id=x where p.effective_salary is null) then raise exception 'Selected golfer does not have a frozen salary'; end if;
  select sum(p.effective_salary) into total from public.golf_salary_prices p where p.price_set_id=ps.id and p.player_id=any(p_player_ids); if total>cap then raise exception 'Lineup exceeds the $% salary cap',cap; end if;
  select * into lineup from public.golf_salary_cap_lineups where slate_id=p_slate and period_id=period_row.id and team_id=p_team for update; if found and lineup.revision is distinct from p_expected_lineup_revision then raise exception 'Golf Salary Cap lineup changed; refresh and try again'; end if; if not found and p_expected_lineup_revision is not null then raise exception 'Golf Salary Cap lineup changed; refresh and try again'; end if;
  if not found then insert into public.golf_salary_cap_lineups(slate_id,group_id,league_id,period_id,price_set_id,team_id,total_salary) values(p_slate,p_group,p_league,period_row.id,ps.id,p_team,total) returning * into lineup; else update public.golf_salary_cap_lineups set total_salary=total,revision=revision+1,updated_at=clock_timestamp() where id=lineup.id returning * into lineup; end if;
  delete from public.golf_salary_cap_lineup_players where lineup_id=lineup.id; insert into public.golf_salary_cap_lineup_players(lineup_id,player_id,effective_salary) select lineup.id,p.player_id,p.effective_salary from public.golf_salary_prices p where p.price_set_id=ps.id and p.player_id=any(p_player_ids);
  return jsonb_build_object('lineupId',lineup.id,'revision',lineup.revision,'period',p_period,'playerIds',p_player_ids,'totalSalary',total);
end;
$$;

revoke all on function public.create_golf_salary_price_set(bigint,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.review_golf_salary_prices(bigint,uuid,uuid,uuid,text,bigint,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.save_golf_salary_cap_lineup(bigint,uuid,uuid,bigint,uuid,text,bigint,bigint[]) from public,anon,authenticated;
grant execute on function public.review_golf_salary_prices(bigint,uuid,uuid,uuid,text,bigint,jsonb,boolean) to service_role;
grant execute on function public.save_golf_salary_cap_lineup(bigint,uuid,uuid,bigint,uuid,text,bigint,bigint[]) to service_role;

commit;
