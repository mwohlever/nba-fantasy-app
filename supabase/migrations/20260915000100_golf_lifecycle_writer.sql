-- UNAPPLIED. Explicit opt-in service RPCs; no routes, backfill, or existing RPC replacement.
-- Requires 20260911000100 and 20260914000100. Review/test in disposable Postgres first.
begin;

-- Internal shared serialization primitive. Never expose this as standalone authorization.
create function public.lock_golf_lifecycle(p_slate bigint,p_group uuid,p_league uuid)
returns bigint language plpgsql security definer set search_path=public as $$
declare s slates%rowtype; v bigint;
begin
 select * into s from slates where id=p_slate for update;
 if not found or s.sport<>'golf' or s.league_id is distinct from p_league
   or not exists(select 1 from leagues where id=p_league and group_id=p_group and sport_key='golf' and is_enabled) then
   raise exception 'Golf lifecycle scope mismatch'; end if;
 insert into golf_accepted_versions(slate_id) values(p_slate) on conflict do nothing;
 select revision into v from golf_accepted_versions where slate_id=p_slate for update;
 perform id from golf_roster_periods where slate_id=p_slate order by id for update;
 if exists(select 1 from golf_roster_periods where slate_id=p_slate and
   (group_id is distinct from p_group or league_id is distinct from p_league or rules_snapshot is distinct from s.rules_snapshot)) then
   raise exception 'Frozen Golf lifecycle scope/configuration mismatch'; end if;
 return v;
end;
$$;

create function public.initialize_golf_lifecycle(p_slate bigint,p_group uuid,p_league uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v bigint; snapshot jsonb; keys text[]; k text;
begin
 v:=lock_golf_lifecycle(p_slate,p_group,p_league);
 if not exists(select 1 from app_users a where a.id=p_actor and a.is_active and
   (a.system_role='super_admin' or exists(select 1 from group_memberships m where m.user_id=a.id and m.group_id=p_group and m.is_active and m.role='admin'))) then
   raise exception 'Group commissioner required for explicit lifecycle enrollment'; end if;
 select rules_snapshot into snapshot from slates where id=p_slate;
 keys:=case when coalesce((snapshot#>>'{rosterPeriods,type}')='split_after_round_2' and
   (not(snapshot?'sport') or snapshot->>'sport'='golf'),false) then array['opening','weekend'] else array['full_tournament'] end;
 if exists(select 1 from golf_roster_periods where slate_id=p_slate and not(period_key=any(keys))) then raise exception 'Unexpected period identity'; end if;
 foreach k in array keys loop
   insert into golf_roster_periods(slate_id,group_id,league_id,period_key,rules_snapshot,accepted_revision,evidence_reference,evidence_snapshot)
   values(p_slate,p_group,p_league,k,snapshot,v,'explicit_initialization',jsonb_build_object('actorId',p_actor))
   on conflict(slate_id,period_key) do nothing;
 end loop;
 -- Seed already-accepted play/locks without fabricating historical open timestamps.
 perform write_golf_lifecycle_facts(p_slate,p_group,p_league,v,
   (select jsonb_object_agg(period_key,revision) from golf_roster_periods where slate_id=p_slate));
 return (select jsonb_agg(to_jsonb(period_row) order by period_row.id) from golf_roster_periods period_row where period_row.slate_id=p_slate);
end;
$$;

-- Trusted server fact plan. Opening/completion confirmations are deliberately not
-- accepted here yet: no reviewed tournament evidence adapter exists. Restrictive
-- explicit locks are supported; accepted starts are always read from canonical DB state.
create function public.write_golf_lifecycle_facts(
 p_slate bigint,p_group uuid,p_league uuid,p_expected_accepted bigint,
 p_expected_periods jsonb,p_lock_reason text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v bigint; starts integer[]; p golf_roster_periods%rowtype; should_lock boolean; why text;
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
   should_lock:=p_lock_reason is not null or (select is_locked from slates where id=p_slate) or
     (p.period_key='weekend' and starts && array[3,4]) or
     (p.period_key='opening' and cardinality(starts)>0) or
     (p.period_key='full_tournament' and (select is_locked from slates where id=p_slate));
   why:=case when p.period_key='weekend' and starts && array[3,4] then 'round_3_started'
     when p.period_key='opening' and cardinality(starts)>0 then 'opening_play_started'
     else coalesce(p_lock_reason,'acquisition_locked') end;
   -- No-op writes do not churn revisions or audit records.
   if p.started_rounds is distinct from starts or p.accepted_revision<>v or (should_lock and p.locked_at is null) then
     update golf_roster_periods set revision=revision+1,accepted_revision=v,started_rounds=starts,
       locked_at=case when should_lock then coalesce(locked_at,clock_timestamp()) else locked_at end,
       lock_reason=case when should_lock then coalesce(lock_reason,why) else lock_reason end,
       evidence_reference='accepted_state:'||v::text,
       evidence_snapshot=jsonb_build_object('acceptedRevision',v,'explicitLockReason',p_lock_reason)
     where id=p.id;
   end if;
 end loop;
 return (select jsonb_agg(to_jsonb(period_row) order by period_row.id) from golf_roster_periods period_row where period_row.slate_id=p_slate);
end;
$$;

-- Opt-in replacement CALL SITE, not replacement of the existing production function.
-- A fact failure raises, rolling back the nested accepted scoring commit as well.
create function public.commit_golf_reconciliation_with_lifecycle(
 p_slate_id bigint,p_group uuid,p_league uuid,p_expected_revision bigint,p_expected_periods jsonb,
 p_holes jsonb,p_rounds jsonb,p_events jsonb,p_teams jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v bigint; result jsonb; facts jsonb; expected_after_retention jsonb;
begin
 v:=lock_golf_lifecycle(p_slate_id,p_group,p_league);
 if v is distinct from p_expected_revision then raise exception 'Accepted Golf revision conflict'; end if;
 -- Preserve existing play before an accepted retraction can remove its last score.
 perform write_golf_lifecycle_facts(p_slate_id,p_group,p_league,v,p_expected_periods);
 select jsonb_object_agg(period_key,revision) into expected_after_retention from golf_roster_periods where slate_id=p_slate_id;
 result:=commit_golf_reconciliation(p_slate_id,p_expected_revision,p_holes,p_rounds,p_events,p_teams);
 if coalesce((result->>'conflict')::boolean,false) then raise exception 'Accepted Golf revision conflict'; end if;
 facts:=write_golf_lifecycle_facts(p_slate_id,p_group,p_league,(result->>'revision')::bigint,expected_after_retention);
 return result||jsonb_build_object('periods',facts);
end;
$$;

-- Explicit reviewed confirmations, not automatic provider normalization. These
-- retain history only; opened_at is NEVER sufficient acquisition authorization.
create function public.confirm_golf_period_history(
 p_slate bigint,p_group uuid,p_league uuid,p_actor uuid,p_period text,
 p_expected_accepted bigint,p_expected_period bigint,p_action text,p_evidence jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v bigint; p golf_roster_periods%rowtype; t timestamptz;
begin
 v:=lock_golf_lifecycle(p_slate,p_group,p_league);
 if v is distinct from p_expected_accepted then raise exception 'Accepted Golf revision conflict'; end if;
 if not exists(select 1 from app_users a where a.id=p_actor and a.is_active and
   (a.system_role='super_admin' or exists(select 1 from group_memberships m where m.user_id=a.id and m.group_id=p_group and m.is_active and m.role='admin'))) then
   raise exception 'Group commissioner review required'; end if;
 select * into p from golf_roster_periods where slate_id=p_slate and period_key=p_period;
 if not found or p.revision is distinct from p_expected_period then raise exception 'Golf period revision conflict'; end if;
 -- Deadline evaluation must use time AFTER any serialization wait.
 t:=clock_timestamp();
 if jsonb_typeof(p_evidence) is distinct from 'object' or
   coalesce(length(trim(p_evidence->>'sourceReference')),0)=0 or
   (p_evidence->>'observedAt') is null or
   not isfinite((p_evidence->>'observedAt')::timestamptz) or
   (p_evidence->>'observedAt')::timestamptz>t then raise exception 'Reviewed evidence required'; end if;
 if p_action='opened' then
   if p.locked_at is not null or p.completed_at is not null or (select is_locked from slates where id=p_slate) then raise exception 'Acquisition closed'; end if;
   -- Positive accepted play dominates a stale reviewed pre-start assertion.
   if exists(select 1 from golf_rounds r join golf_event_players e on e.id=r.event_player_id
     where e.slate_id=p_slate and r.round_number between 1 and 4
     and (p_period<>'weekend' or r.round_number>=3)
     and (r.holes_completed>0 or exists(select 1 from golf_holes h where h.round_id=r.id and h.strokes>0)))
     or (p_period='weekend' and p.started_rounds && array[3,4])
     or (p_period<>'weekend' and cardinality(p.started_rounds)>0) then raise exception 'Competition play started'; end if;
   if coalesce((p_evidence->>'tournamentComplete')::boolean,true) or
      (p_evidence->>'acquisitionDeadline') is null or not isfinite((p_evidence->>'acquisitionDeadline')::timestamptz) or (p_evidence->>'acquisitionDeadline')::timestamptz<=t then raise exception 'Explicit future acquisition deadline required'; end if;
   if p_period='weekend' then
     if not coalesce((p_evidence->>'round2Complete')::boolean,false)
       or not coalesce((p_evidence->>'round3NotStarted')::boolean,false)
       or coalesce((p_evidence->>'regulationRoundCount')::integer,0) not in (3,4)
       or coalesce(p_evidence->>'cut','unknown') not in ('confirmed','no_cut')
       or not coalesce((p_evidence->>'fieldComplete')::boolean,false)
       or jsonb_typeof(p_evidence->'players') is distinct from 'array' then raise exception 'Weekend confirmation incomplete'; end if;
     if jsonb_array_length(p_evidence->'players')=0 or exists(
       select 1 from jsonb_array_elements(p_evidence->'players') x
       where coalesce(x->>'eligibility','unknown') not in ('made_cut','continuing','missed_cut','withdrawn','disqualified','did_not_start')
       or not exists(select 1 from golf_event_players e where e.slate_id=p_slate and e.player_id=(x->>'playerId')::bigint)
     ) or (select count(distinct (x->>'playerId')::bigint) from jsonb_array_elements(p_evidence->'players') x)
       <>jsonb_array_length(p_evidence->'players') or exists(
       select 1 from golf_event_players e where e.slate_id=p_slate and not exists(
         select 1 from jsonb_array_elements(p_evidence->'players') x where (x->>'playerId')::bigint=e.player_id)) then raise exception 'Exhaustive classified field required'; end if;
   end if;
 elsif p_action='completed' then
   if not coalesce((p_evidence->>'tournamentComplete')::boolean,false) and
     not (p_period='opening' and coalesce((p_evidence->>'round2Complete')::boolean,false)) then raise exception 'Completion confirmation required'; end if;
 else raise exception 'Unknown history action'; end if;
 -- Repeated confirmations preserve first timestamps; no unlock/reset operation.
 update golf_roster_periods set revision=revision+1,accepted_revision=v,
   opened_at=case when p_action='opened' then coalesce(opened_at,t) else opened_at end,
   completed_at=case when p_action='completed' then coalesce(completed_at,t) else completed_at end,
   locked_at=case when p_action='completed' then coalesce(locked_at,t) else locked_at end,
   lock_reason=case when p_action='completed' then coalesce(lock_reason,'confirmed_completion') else lock_reason end,
   evidence_reference=p_evidence->>'sourceReference',
   evidence_snapshot=p_evidence||jsonb_build_object('reviewedBy',p_actor,'action',p_action)
 where id=p.id returning * into p;
 return to_jsonb(p);
end;
$$;
revoke all on function public.confirm_golf_period_history(bigint,uuid,uuid,uuid,text,bigint,bigint,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.confirm_golf_period_history(bigint,uuid,uuid,uuid,text,bigint,bigint,text,jsonb) to service_role;

revoke all on function public.lock_golf_lifecycle(bigint,uuid,uuid),
 public.initialize_golf_lifecycle(bigint,uuid,uuid,uuid),
 public.write_golf_lifecycle_facts(bigint,uuid,uuid,bigint,jsonb,text),
 public.commit_golf_reconciliation_with_lifecycle(bigint,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.initialize_golf_lifecycle(bigint,uuid,uuid,uuid),
 public.write_golf_lifecycle_facts(bigint,uuid,uuid,bigint,jsonb,text),
 public.commit_golf_reconciliation_with_lifecycle(bigint,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
commit;
