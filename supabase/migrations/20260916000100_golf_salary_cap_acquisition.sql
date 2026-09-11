-- MANUAL REVIEW/APPLICATION ONLY. Requires the unapplied Golf reconciliation,
-- roster-period, and lifecycle-writer migrations. No existing Golf mode is enabled.
begin;

-- Retain the authoritative field feed's amateur classification so Value V1
-- can apply its fixed $10 amateur suggestion during server-side generation.
alter table public.golf_event_players
  add column if not exists is_amateur boolean not null default false;

create table public.golf_salary_price_sets (
  id bigint generated always as identity primary key,
  slate_id bigint not null unique references public.slates(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  league_id uuid not null references public.leagues(id) on delete restrict,
  rules_snapshot jsonb not null,
  status text not null check (status in ('generated','frozen')),
  revision bigint not null default 0 check (revision >= 0),
  generated_at timestamptz not null default clock_timestamp(),
  generated_by uuid not null references public.app_users(id) on delete restrict,
  frozen_at timestamptz,
  frozen_by uuid references public.app_users(id) on delete restrict,
  check ((status='generated' and frozen_at is null and frozen_by is null)
    or (status='frozen' and frozen_at is not null and frozen_by is not null))
);
create index golf_salary_price_sets_scope on public.golf_salary_price_sets(group_id,league_id,slate_id);

create table public.golf_salary_prices (
  id bigint generated always as identity primary key,
  price_set_id bigint not null references public.golf_salary_price_sets(id) on delete restrict,
  player_id bigint not null references public.golf_players(id) on delete restrict,
  suggested_salary integer check (suggested_salary between 10 and 42),
  override_salary integer check (override_salary between 10 and 42),
  effective_salary integer check (effective_salary between 10 and 42),
  is_amateur boolean not null default false,
  value_basis text not null check (value_basis in ('blended','v1_only','owgr_only','unsupported','amateur')),
  value_version text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(price_set_id,player_id),
  check ((value_basis='unsupported' and suggested_salary is null and override_salary is null and effective_salary is null)
    or value_basis<>'unsupported')
);
create index golf_salary_prices_set_player on public.golf_salary_prices(price_set_id,player_id);

create function public.guard_frozen_golf_salary_price() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_price_set bigint;
begin
  v_price_set:=case when tg_op='DELETE' then old.price_set_id else new.price_set_id end;
  if exists(select 1 from public.golf_salary_price_sets s where s.id=v_price_set and s.status='frozen') then
    raise exception 'Frozen Golf salaries are immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger golf_salary_price_frozen_guard before update or delete on public.golf_salary_prices
for each row execute function public.guard_frozen_golf_salary_price();

create table public.golf_salary_cap_lineups (
  id bigint generated always as identity primary key,
  slate_id bigint not null references public.slates(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  league_id uuid not null references public.leagues(id) on delete restrict,
  period_id bigint not null references public.golf_roster_periods(id) on delete restrict,
  price_set_id bigint not null references public.golf_salary_price_sets(id) on delete restrict,
  team_id bigint not null references public.teams(id) on delete restrict,
  total_salary integer not null check (total_salary >= 0),
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(slate_id,period_id,team_id)
);
create index golf_salary_cap_lineups_scope on public.golf_salary_cap_lineups(group_id,league_id,slate_id,period_id,team_id);

create table public.golf_salary_cap_lineup_players (
  lineup_id bigint not null references public.golf_salary_cap_lineups(id) on delete restrict,
  player_id bigint not null references public.golf_players(id) on delete restrict,
  effective_salary integer not null check (effective_salary between 10 and 42),
  primary key(lineup_id,player_id)
);

create function public.assert_golf_salary_cap_scope(p_slate bigint,p_group uuid,p_league uuid)
returns public.slates language plpgsql security definer set search_path=public as $$
declare s public.slates%rowtype;
begin
  select * into s from public.slates where id=p_slate for update;
  if not found or s.sport<>'golf' or s.league_id is distinct from p_league
    or coalesce(s.rules_snapshot#>>'{draft,type}','snake')<>'salary_cap'
    or not exists(select 1 from public.leagues l where l.id=p_league and l.group_id=p_group and l.sport_key='golf' and l.is_enabled) then
    raise exception 'Golf Salary Cap slate scope/configuration mismatch';
  end if;
  return s;
end;
$$;

-- The app calls this only with pure-model output generated server-side. This
-- function intentionally has no public/client grant: suggested prices cannot
-- be supplied or changed by a browser.
create function public.create_golf_salary_price_set(
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
  select count(*) into v_count from jsonb_to_recordset(p_prices) x(player_id bigint,suggested_salary integer,is_amateur boolean,value_basis text,value_version text);
  if v_count<>expected or (select count(distinct x.player_id) from jsonb_to_recordset(p_prices) x(player_id bigint,suggested_salary integer,is_amateur boolean,value_basis text,value_version text))<>expected
    or exists(select 1 from jsonb_to_recordset(p_prices) x(player_id bigint,suggested_salary integer,is_amateur boolean,value_basis text,value_version text)
      where x.player_id is null or not exists(select 1 from public.golf_event_players e where e.slate_id=p_slate and e.player_id=x.player_id)
        or x.value_basis not in ('blended','v1_only','owgr_only','unsupported','amateur')
        or coalesce(nullif(trim(x.value_version),''),'')=''
        or (x.value_basis='unsupported' and x.suggested_salary is not null)
        or (x.value_basis<>'unsupported' and (x.suggested_salary is null or x.suggested_salary not between 10 and 42))
        or (coalesce(x.is_amateur,false) and (x.suggested_salary<>10 or x.value_basis<>'amateur')))
    then raise exception 'Generated price set does not exactly match the authoritative field'; end if;
  insert into public.golf_salary_price_sets(slate_id,group_id,league_id,rules_snapshot,status,generated_by)
    values(p_slate,p_group,p_league,s.rules_snapshot,'generated',p_actor) returning * into ps;
  insert into public.golf_salary_prices(price_set_id,player_id,suggested_salary,is_amateur,value_basis,value_version)
    select ps.id,x.player_id,x.suggested_salary,coalesce(x.is_amateur,false),x.value_basis,x.value_version
    from jsonb_to_recordset(p_prices) x(player_id bigint,suggested_salary integer,is_amateur boolean,value_basis text,value_version text);
  return jsonb_build_object('priceSetId',ps.id,'status',ps.status,'revision',ps.revision);
end;
$$;

create function public.freeze_golf_salary_price_set(p_slate bigint,p_group uuid,p_league uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.slates%rowtype; ps public.golf_salary_price_sets%rowtype; expected integer; priced integer;
begin
  s:=assert_golf_salary_cap_scope(p_slate,p_group,p_league);
  if not exists(select 1 from public.app_users a where a.id=p_actor and a.is_active and
    (a.system_role='super_admin' or exists(select 1 from public.group_memberships m where m.group_id=p_group and m.user_id=a.id and m.is_active and m.role='admin'))) then raise exception 'Group commissioner required'; end if;
  if s.is_locked then raise exception 'Golf slate is locked'; end if;
  select * into ps from public.golf_salary_price_sets where slate_id=p_slate for update;
  if not found then raise exception 'Generate Golf salaries first'; end if;
  if ps.status='frozen' then return jsonb_build_object('priceSetId',ps.id,'status','frozen','revision',ps.revision); end if;
  if ps.rules_snapshot is distinct from s.rules_snapshot then raise exception 'Frozen rules changed; regenerate price set'; end if;
  select count(*) into expected from public.golf_event_players where slate_id=p_slate;
  select count(*) into priced from public.golf_salary_prices where price_set_id=ps.id;
  if expected=0 or priced<>expected or exists(select 1 from public.golf_salary_prices where price_set_id=ps.id and value_basis<>'unsupported' and coalesce(override_salary,suggested_salary) is null) then raise exception 'Incomplete generated Golf prices'; end if;
  update public.golf_salary_prices set effective_salary=case when value_basis='unsupported' then null else coalesce(override_salary,suggested_salary) end where price_set_id=ps.id;
  update public.golf_salary_price_sets set status='frozen',revision=revision+1,frozen_at=clock_timestamp(),frozen_by=p_actor where id=ps.id returning * into ps;
  return jsonb_build_object('priceSetId',ps.id,'status',ps.status,'revision',ps.revision);
end;
$$;

-- Replaces exactly one team's roster for exactly one authoritative period. It
-- locks slate -> accepted version -> period -> price set -> lineup, preventing
-- a stale pre-lock view from saving after canonical R1/R3 start evidence.
create function public.save_golf_salary_cap_lineup(
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
  select coalesce(sum((x->>'slotCount')::integer),0) into roster_size from jsonb_array_elements(s.rules_snapshot#>'{roster,slots}') x;
  cap:=coalesce((s.rules_snapshot#>>'{draft,salaryCap}')::integer,100);
  if roster_size<>4 or cap<>100 then raise exception 'This V1 Salary Cap requires four golfers and a $100 budget'; end if;
  if p_player_ids is null or cardinality(p_player_ids)<>roster_size or exists(select 1 from unnest(p_player_ids) x where x is null) or cardinality(p_player_ids)<>(select count(distinct x) from unnest(p_player_ids) x) then raise exception 'Select exactly four unique golfers'; end if;
  if exists(select 1 from unnest(p_player_ids) x where not exists(select 1 from public.golf_event_players e where e.slate_id=p_slate and e.player_id=x)) then raise exception 'Selected golfer is outside this tournament field'; end if;
  if p_period='weekend' and (jsonb_typeof(period_row.evidence_snapshot->'players') is distinct from 'array' or exists(select 1 from unnest(p_player_ids) x where not exists(select 1 from jsonb_array_elements(period_row.evidence_snapshot->'players') q where (q->>'playerId')::bigint=x and q->>'eligibility' in ('made_cut','continuing')))) then raise exception 'Selected golfer is not eligible for the weekend roster'; end if;
  if exists(select 1 from unnest(p_player_ids) x left join public.golf_salary_prices p on p.price_set_id=ps.id and p.player_id=x where p.effective_salary is null) then raise exception 'Selected golfer does not have a frozen salary'; end if;
  select sum(p.effective_salary) into total from public.golf_salary_prices p where p.price_set_id=ps.id and p.player_id=any(p_player_ids);
  if total>cap then raise exception 'Lineup exceeds the $100 salary cap'; end if;
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

alter table public.golf_salary_price_sets enable row level security;
alter table public.golf_salary_prices enable row level security;
alter table public.golf_salary_cap_lineups enable row level security;
alter table public.golf_salary_cap_lineup_players enable row level security;
revoke all on public.golf_salary_price_sets,public.golf_salary_prices,public.golf_salary_cap_lineups,public.golf_salary_cap_lineup_players from public,anon,authenticated,service_role;
grant select on public.golf_salary_price_sets,public.golf_salary_prices,public.golf_salary_cap_lineups,public.golf_salary_cap_lineup_players to service_role;
revoke all on function public.guard_frozen_golf_salary_price(),public.assert_golf_salary_cap_scope(bigint,uuid,uuid),public.create_golf_salary_price_set(bigint,uuid,uuid,uuid,jsonb),public.freeze_golf_salary_price_set(bigint,uuid,uuid,uuid),public.save_golf_salary_cap_lineup(bigint,uuid,uuid,bigint,uuid,text,bigint,bigint[]) from public,anon,authenticated,service_role;
grant execute on function public.create_golf_salary_price_set(bigint,uuid,uuid,uuid,jsonb),public.freeze_golf_salary_price_set(bigint,uuid,uuid,uuid),public.save_golf_salary_cap_lineup(bigint,uuid,uuid,bigint,uuid,text,bigint,bigint[]) to service_role;
commit;
