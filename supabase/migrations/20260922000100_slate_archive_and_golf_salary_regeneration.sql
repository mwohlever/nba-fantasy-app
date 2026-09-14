begin;

alter table public.slates add column if not exists archived_at timestamptz;
create index if not exists slates_active_league_sport_dates on public.slates(league_id,sport,start_date desc,end_date desc) where archived_at is null;

create or replace function public.guard_golf_analytics_evidence() returns trigger language plpgsql as $$
begin
  if tg_table_name='golf_salary_board_inputs' and tg_op='DELETE'
    and current_setting('app.golf_salary_regeneration',true)='on'
    and exists(select 1 from public.golf_salary_price_sets s where s.id=old.price_set_id and s.status='generated') then return old; end if;
  raise exception 'Golf analytics evidence is immutable';
end; $$;

create function public.regenerate_golf_salary_price_set_with_manifest(
  p_slate bigint,p_group uuid,p_league uuid,p_actor uuid,p_prices jsonb,p_manifest jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.slates%rowtype; ps public.golf_salary_price_sets%rowtype; created jsonb;
begin
  s:=public.assert_golf_salary_cap_scope(p_slate,p_group,p_league);
  if not exists(select 1 from public.app_users a where a.id=p_actor and a.is_active and (a.system_role='super_admin' or exists(select 1 from public.group_memberships m where m.group_id=p_group and m.user_id=a.id and m.is_active and m.role='admin'))) then raise exception 'Group commissioner required'; end if;
  perform public.lock_golf_lifecycle(p_slate,p_group,p_league);
  select * into ps from public.golf_salary_price_sets where slate_id=p_slate for update;
  if not found or ps.status<>'generated' then raise exception 'Only an unfrozen generated Golf salary board may be regenerated'; end if;
  if s.is_locked or exists(select 1 from public.golf_roster_periods where slate_id=p_slate and period_key<>'weekend' and (locked_at is not null or completed_at is not null or cardinality(started_rounds)>0 or (evidence_snapshot->>'acquisitionDeadline' is not null and (evidence_snapshot->>'acquisitionDeadline')::timestamptz<=clock_timestamp()))) or exists(select 1 from public.golf_rounds r join public.golf_event_players e on e.id=r.event_player_id where e.slate_id=p_slate and (r.holes_completed>0 or exists(select 1 from public.golf_holes h where h.round_id=r.id and h.strokes>0))) then raise exception 'Salary setup is locked'; end if;
  if exists(select 1 from public.golf_salary_cap_lineups where price_set_id=ps.id) then raise exception 'Generated Golf salary board is already referenced by a lineup'; end if;
  perform set_config('app.golf_salary_regeneration','on',true);
  delete from public.golf_salary_board_inputs where price_set_id=ps.id;
  delete from public.golf_salary_prices where price_set_id=ps.id;
  delete from public.golf_salary_price_sets where id=ps.id;
  created:=public.create_golf_salary_price_set_with_manifest(p_slate,p_group,p_league,p_actor,p_prices,p_manifest);
  return created;
end; $$;
revoke all on function public.regenerate_golf_salary_price_set_with_manifest(bigint,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.regenerate_golf_salary_price_set_with_manifest(bigint,uuid,uuid,uuid,jsonb,jsonb) to service_role;
commit;
