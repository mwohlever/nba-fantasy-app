-- Manual application only. Retain independent Snake Weekend draft results.
begin;
create table public.golf_snake_period_lineups (
  slate_id bigint not null references public.slates(id) on delete restrict,
  team_id bigint not null references public.teams(id) on delete restrict,
  period_key text not null check (period_key='weekend'),
  player_ids bigint[] not null,
  revision bigint not null default 0,
  primary key(slate_id,team_id,period_key)
);
alter table public.golf_snake_period_lineups enable row level security;
revoke all on public.golf_snake_period_lineups from public,anon,authenticated,service_role;
grant select on public.golf_snake_period_lineups to service_role;

create function public.save_golf_snake_weekend_roster(p_slate bigint,p_group uuid,p_league uuid,p_actor uuid,
  p_team bigint,p_player_ids bigint[],p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s slates%rowtype; p golf_roster_periods%rowtype; existing golf_snake_period_lineups%rowtype; n integer;
begin
  perform lock_golf_lifecycle(p_slate,p_group,p_league);
  select * into s from slates where id=p_slate;
  if coalesce(s.rules_snapshot#>>'{draft,type}','snake')<>'snake' or s.rules_snapshot#>>'{rosterPeriods,type}' is distinct from 'split_after_round_2'
  then raise exception 'Split Snake slate required'; end if;
  if not exists(select 1 from app_users a where a.id=p_actor and a.is_active and
    (a.system_role='super_admin' or exists(select 1 from group_memberships m where m.user_id=a.id and m.group_id=p_group and m.is_active and m.role='admin')))
  then raise exception 'Commissioner records the Weekend draft'; end if;
  if not exists(select 1 from teams t join group_memberships m on m.user_id=t.user_id and m.group_id=t.group_id and m.is_active
    join slate_teams st on st.team_id=t.id and st.slate_id=p_slate and st.is_participating where t.id=p_team and t.group_id=p_group)
  then raise exception 'Active Group participant required'; end if;
  select * into p from golf_roster_periods where slate_id=p_slate and period_key='weekend' for update;
  if not found or p.opened_at is null or p.locked_at is not null or p.completed_at is not null or p.started_rounds && array[3,4]
    or (p.evidence_snapshot->>'acquisitionDeadline') is null or (p.evidence_snapshot->>'acquisitionDeadline')::timestamptz<=clock_timestamp()
    or exists(select 1 from golf_rounds r join golf_event_players e on e.id=r.event_player_id where e.slate_id=p_slate and r.round_number>=3 and
      (r.holes_completed>0 or exists(select 1 from golf_holes h where h.round_id=r.id and h.strokes>0)))
  then raise exception 'Weekend draft is locked or unavailable'; end if;
  n:=(s.rules_snapshot#>>'{roster,slots,0,slotCount}')::integer;
  if n is null or n<1 or p_player_ids is null or cardinality(p_player_ids)<>n
    or cardinality(p_player_ids)<>(select count(distinct x) from unnest(p_player_ids) x)
  then raise exception 'Select exactly % unique golfers',n; end if;
  if jsonb_typeof(p.evidence_snapshot->'players') is distinct from 'array' or exists(select 1 from unnest(p_player_ids) x where
    not exists(select 1 from golf_event_players e where e.slate_id=p_slate and e.player_id=x)
    or not exists(select 1 from jsonb_array_elements(p.evidence_snapshot->'players') q where (q->>'playerId')::bigint=x and q->>'eligibility' in ('made_cut','continuing')))
  then raise exception 'Golfer is not eligible for Weekend'; end if;
  if exists(select 1 from golf_snake_period_lineups where slate_id=p_slate and team_id<>p_team and player_ids && p_player_ids)
  then raise exception 'Golfer already drafted by another team for Weekend'; end if;
  select * into existing from golf_snake_period_lineups where slate_id=p_slate and team_id=p_team and period_key='weekend' for update;
  if (found and existing.revision is distinct from p_expected_revision) or (not found and p_expected_revision is not null)
  then raise exception 'Weekend roster changed; reload'; end if;
  insert into golf_snake_period_lineups(slate_id,team_id,period_key,player_ids) values(p_slate,p_team,'weekend',p_player_ids)
    on conflict(slate_id,team_id,period_key) do update set player_ids=excluded.player_ids,revision=golf_snake_period_lineups.revision+1;
  update golf_accepted_versions set revision=revision+1 where slate_id=p_slate;
  return jsonb_build_object('success',true);
end;
$$;

-- Serialize roster edits with accepted-state commits. Snake Opening stays in its
-- existing store and cannot be repurposed for Weekend or changed after R1 starts.
create function public.guard_golf_scoring_roster_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare sid bigint; s slates%rowtype; lid bigint;
begin
  if tg_table_name in ('lineups','golf_salary_cap_lineups') then
    sid:=case when tg_op='DELETE' then old.slate_id else new.slate_id end;
    if tg_op='UPDATE' and old.slate_id is distinct from new.slate_id and
      exists(select 1 from slates where id in (old.slate_id,new.slate_id) and sport='golf')
    then raise exception 'Golf rosters cannot move between slates'; end if;
  else
    lid:=case when tg_op='DELETE' then old.lineup_id else new.lineup_id end;
    if tg_table_name='lineup_players' then select slate_id into sid from lineups where id=lid;
    else select slate_id into sid from golf_salary_cap_lineups where id=lid; end if;
    if tg_op='UPDATE' and old.lineup_id is distinct from new.lineup_id and
      (tg_table_name='golf_salary_cap_lineup_players' or exists(select 1 from lineups l join slates s on s.id=l.slate_id
        where l.id in (old.lineup_id,new.lineup_id) and s.sport='golf'))
    then raise exception 'Golf roster entries cannot move between lineups'; end if;
  end if;
  select * into s from slates where id=sid;
  if s.sport='golf' then
    perform id from slates where id=sid for update;
    insert into golf_accepted_versions(slate_id) values(sid) on conflict do nothing;
    perform revision from golf_accepted_versions where slate_id=sid for update;
    if tg_table_name in ('lineups','lineup_players') and s.rules_snapshot#>>'{rosterPeriods,type}'='split_after_round_2' and
      (exists(select 1 from golf_roster_periods where slate_id=sid and period_key='opening' and
        (locked_at is not null or completed_at is not null or cardinality(started_rounds)>0))
      or exists(select 1 from golf_rounds r join golf_event_players e on e.id=r.event_player_id where e.slate_id=sid and
        (r.holes_completed>0 or exists(select 1 from golf_holes h where h.round_id=r.id and h.strokes>0))))
    then raise exception 'Opening roster is locked; record Weekend independently'; end if;
    update golf_accepted_versions set revision=revision+1 where slate_id=sid;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger golf_snake_scoring_revision before insert or update or delete on public.lineup_players
for each row execute function public.guard_golf_scoring_roster_change();
create trigger golf_salary_scoring_revision before insert or update or delete on public.golf_salary_cap_lineup_players
for each row execute function public.guard_golf_scoring_roster_change();
-- Parent deletes must invalidate results even when cascading children can no
-- longer resolve the deleted parent. Revisions are opaque monotonic tokens;
-- multiple increments in one transaction are intentional and roll back together.
create trigger golf_snake_lineup_revision before insert or update or delete on public.lineups
for each row execute function public.guard_golf_scoring_roster_change();
create trigger golf_salary_lineup_revision before insert or update or delete on public.golf_salary_cap_lineups
for each row execute function public.guard_golf_scoring_roster_change();
revoke all on function public.guard_golf_scoring_roster_change(),public.save_golf_snake_weekend_roster(bigint,uuid,uuid,uuid,bigint,bigint[],bigint) from public,anon,authenticated;
grant execute on function public.save_golf_snake_weekend_roster(bigint,uuid,uuid,uuid,bigint,bigint[],bigint) to service_role;
commit;
