-- MANUAL REVIEW/APPLICATION ONLY. Corrects PL/pgSQL variable/SQL alias
-- ambiguity in the existing Golf roster-write trigger. No data is changed.
begin;

create or replace function public.guard_golf_scoring_roster_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare sid bigint; slate_row slates%rowtype; lid bigint;
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
      (tg_table_name='golf_salary_cap_lineup_players' or exists(select 1 from lineups l join slates slate on slate.id=l.slate_id
        where l.id in (old.lineup_id,new.lineup_id) and slate.sport='golf'))
    then raise exception 'Golf roster entries cannot move between lineups'; end if;
  end if;
  select * into slate_row from slates where id=sid;
  if slate_row.sport='golf' then
    perform id from slates where id=sid for update;
    insert into golf_accepted_versions(slate_id) values(sid) on conflict do nothing;
    perform revision from golf_accepted_versions where slate_id=sid for update;
    if tg_table_name in ('lineups','lineup_players') and slate_row.rules_snapshot#>>'{rosterPeriods,type}'='split_after_round_2' and
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

revoke all on function public.guard_golf_scoring_roster_change() from public,anon,authenticated,service_role;

commit;
