-- Additive upgrade to migration 160, which is already applied.
-- No price changes, data backfills, schema changes, or lifecycle changes.
begin;

create or replace function public.save_golf_salary_cap_lineup(
  p_slate bigint,p_group uuid,p_league uuid,p_team bigint,p_actor uuid,p_period text,
  p_expected_lineup_revision bigint,p_player_ids bigint[]
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.slates%rowtype; period_row public.golf_roster_periods%rowtype; ps public.golf_salary_price_sets%rowtype;
  lineup public.golf_salary_cap_lineups%rowtype; roster_size integer; cap integer; total integer; started boolean;
begin
  s:=assert_golf_salary_cap_scope(p_slate,p_group,p_league);
  perform public.lock_golf_lifecycle(p_slate,p_group,p_league);
  select * into period_row from public.golf_roster_periods where slate_id=p_slate and period_key=p_period for update;
  if not found then raise exception 'Golf roster period is not initialized'; end if;
  select * into ps from public.golf_salary_price_sets where slate_id=p_slate for update;
  if not found or ps.status<>'frozen' then raise exception 'Frozen Golf salary prices required'; end if;
  if ps.rules_snapshot is distinct from s.rules_snapshot then raise exception 'Frozen salary rules mismatch'; end if;
  -- slates.is_locked is the legacy opening boundary. Weekend acquisition is
  -- governed only by its own authoritative period lifecycle.
  if (p_period<>'weekend' and s.is_locked) or period_row.locked_at is not null or period_row.completed_at is not null or period_row.opened_at is null
    or (period_row.evidence_snapshot->>'acquisitionDeadline' is not null
      and (period_row.evidence_snapshot->>'acquisitionDeadline')::timestamptz<=clock_timestamp())
  then raise exception 'This Golf roster period is locked or unavailable'; end if;
  started:=exists(select 1 from public.golf_rounds r join public.golf_event_players e on e.id=r.event_player_id
    where e.slate_id=p_slate and ((p_period in ('full_tournament','opening') and r.round_number=1) or (p_period='weekend' and r.round_number>=3))
      and (r.holes_completed>0 or exists(select 1 from public.golf_holes h where h.round_id=r.id and h.strokes>0)));
  if started then raise exception 'Competition play has already started for this roster period'; end if;
  if not exists(select 1 from public.teams t join public.group_memberships m on m.user_id=t.user_id and m.group_id=t.group_id and m.is_active
    join public.slate_teams st on st.team_id=t.id and st.slate_id=p_slate and st.is_participating
    where t.id=p_team and t.group_id=p_group and (t.user_id=p_actor or exists(select 1 from public.group_memberships a where a.group_id=p_group and a.user_id=p_actor and a.is_active and a.role='admin') or exists(select 1 from public.app_users a where a.id=p_actor and a.system_role='super_admin'))) then raise exception 'Unauthorized Golf participant'; end if;
  -- Read limits from this slate, never current Group settings or client input.
  -- Creation derives count * 25; existing frozen caps and prices remain intact.
  if jsonb_typeof(s.rules_snapshot#>'{roster,slots}') is distinct from 'array' then
    raise exception 'Invalid frozen Golf roster rules';
  end if;
  if jsonb_array_length(s.rules_snapshot#>'{roster,slots}')<>1
    or s.rules_snapshot#>>'{roster,slots,0,position}' is distinct from 'GOLFER'
    or jsonb_typeof(s.rules_snapshot#>'{roster,slots,0,slotCount}') is distinct from 'number'
    or jsonb_typeof(s.rules_snapshot#>'{draft,salaryCap}') is distinct from 'number'
  then raise exception 'Invalid frozen Golf Salary Cap rules'; end if;
  if (s.rules_snapshot#>>'{roster,slots,0,slotCount}')::numeric not between 1 and 50
    or trunc((s.rules_snapshot#>>'{roster,slots,0,slotCount}')::numeric)<>(s.rules_snapshot#>>'{roster,slots,0,slotCount}')::numeric
    or (s.rules_snapshot#>>'{draft,salaryCap}')::numeric<=0
    or trunc((s.rules_snapshot#>>'{draft,salaryCap}')::numeric)<>(s.rules_snapshot#>>'{draft,salaryCap}')::numeric
  then raise exception 'Invalid frozen Golf Salary Cap limits'; end if;
  roster_size:=(s.rules_snapshot#>>'{roster,slots,0,slotCount}')::integer;
  cap:=(s.rules_snapshot#>>'{draft,salaryCap}')::integer;
  if p_player_ids is null or cardinality(p_player_ids)<>roster_size or exists(select 1 from unnest(p_player_ids) x where x is null) or cardinality(p_player_ids)<>(select count(distinct x) from unnest(p_player_ids) x) then raise exception 'Select exactly % unique golfers', roster_size; end if;
  if exists(select 1 from unnest(p_player_ids) x where not exists(select 1 from public.golf_event_players e where e.slate_id=p_slate and e.player_id=x)) then raise exception 'Selected golfer is outside this tournament field'; end if;
  if p_period='weekend' and (jsonb_typeof(period_row.evidence_snapshot->'players') is distinct from 'array' or exists(select 1 from unnest(p_player_ids) x where not exists(select 1 from jsonb_array_elements(period_row.evidence_snapshot->'players') q where (q->>'playerId')::bigint=x and q->>'eligibility' in ('made_cut','continuing')))) then raise exception 'Selected golfer is not eligible for the weekend roster'; end if;
  if exists(select 1 from unnest(p_player_ids) x left join public.golf_salary_prices p on p.price_set_id=ps.id and p.player_id=x where p.effective_salary is null) then raise exception 'Selected golfer does not have a frozen salary'; end if;
  select sum(p.effective_salary) into total from public.golf_salary_prices p where p.price_set_id=ps.id and p.player_id=any(p_player_ids);
  if total>cap then raise exception 'Lineup exceeds the $% salary cap', cap; end if;
  select * into lineup from public.golf_salary_cap_lineups where slate_id=p_slate and period_id=period_row.id and team_id=p_team for update;
  if found and lineup.revision is distinct from p_expected_lineup_revision then raise exception 'Golf Salary Cap lineup changed; refresh and try again'; end if;
  if not found and p_expected_lineup_revision is not null then raise exception 'Golf Salary Cap lineup changed; refresh and try again'; end if;
  if not found then insert into public.golf_salary_cap_lineups(slate_id,group_id,league_id,period_id,price_set_id,team_id,total_salary)
    values(p_slate,p_group,p_league,period_row.id,ps.id,p_team,total) returning * into lineup;
  else update public.golf_salary_cap_lineups set total_salary=total,revision=revision+1,updated_at=clock_timestamp() where id=lineup.id returning * into lineup; end if;
  delete from public.golf_salary_cap_lineup_players where lineup_id=lineup.id;
  insert into public.golf_salary_cap_lineup_players(lineup_id,player_id,effective_salary)
    select lineup.id,p.player_id,p.effective_salary from public.golf_salary_prices p where p.price_set_id=ps.id and p.player_id=any(p_player_ids);
  return jsonb_build_object('lineupId',lineup.id,'revision',lineup.revision,'period',p_period,'playerIds',p_player_ids,'totalSalary',total);
end;
$$;

-- Preserve the service-only RPC boundary.
revoke all on function public.save_golf_salary_cap_lineup(bigint,uuid,uuid,bigint,uuid,text,bigint,bigint[]) from public,anon,authenticated;
grant execute on function public.save_golf_salary_cap_lineup(bigint,uuid,uuid,bigint,uuid,text,bigint,bigint[]) to service_role;
commit;
