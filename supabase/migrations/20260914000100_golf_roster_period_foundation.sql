-- MANUAL REVIEW/APPLICATION ONLY. No backfill, production integration or writer RPC.
-- Applying this creates empty protected tables; it does not enable any Golf mode.
begin;
create table public.golf_roster_periods (
  id bigint generated always as identity primary key,
  slate_id bigint not null references public.slates(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  league_id uuid not null references public.leagues(id) on delete restrict,
  period_key text not null check (period_key in ('full_tournament','opening','weekend')),
  rules_snapshot jsonb,
  revision bigint not null default 0 check (revision >= 0),
  accepted_revision bigint not null default 0 check (accepted_revision >= 0),
  started_rounds integer[] not null default '{}' check (started_rounds <@ array[1,2,3,4] and array_position(started_rounds,null) is null),
  opened_at timestamptz,
  locked_at timestamptz,
  completed_at timestamptz,
  lock_reason text,
  evidence_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_snapshot)='object'),
  evidence_reference text not null check (length(trim(evidence_reference)) > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (slate_id, period_key),
  check ((locked_at is null and lock_reason is null) or (locked_at is not null and lock_reason is not null and length(trim(lock_reason)) > 0))
);
create index golf_roster_period_scope on public.golf_roster_periods(group_id,league_id,slate_id);
create table public.golf_roster_period_audit (
  period_id bigint not null references public.golf_roster_periods(id) on delete restrict,
  revision bigint not null,
  recorded_at timestamptz not null default clock_timestamp(),
  facts jsonb not null,
  primary key(period_id,revision)
);

create function public.guard_golf_roster_period() returns trigger
language plpgsql security definer set search_path=public as $$
declare s public.slates%rowtype; split boolean;
begin
  if tg_op='DELETE' then raise exception 'Golf period history cannot be deleted'; end if;
  select * into s from slates where id=new.slate_id for update;
  if not found or s.sport<>'golf' or s.league_id is distinct from new.league_id
    or not exists(select 1 from leagues where id=new.league_id and group_id=new.group_id and sport_key='golf') then
    raise exception 'Golf period scope mismatch';
  end if;
  if tg_op='INSERT' then
    if exists(select 1 from golf_roster_periods p where p.slate_id=new.slate_id and
      (p.rules_snapshot is distinct from new.rules_snapshot or p.group_id<>new.group_id or p.league_id<>new.league_id)) then raise exception 'Existing period configuration differs'; end if;
    if new.rules_snapshot is distinct from s.rules_snapshot or new.revision<>0 then raise exception 'Use frozen slate rules and initial revision'; end if;
  else
    if (new.id,new.slate_id,new.group_id,new.league_id,new.period_key,new.created_at)
      is distinct from (old.id,old.slate_id,old.group_id,old.league_id,old.period_key,old.created_at)
      or new.rules_snapshot is distinct from old.rules_snapshot then raise exception 'Golf period identity is immutable'; end if;
    if new.revision<>old.revision+1 or new.accepted_revision<old.accepted_revision then raise exception 'Golf period revision conflict'; end if;
    if not old.started_rounds <@ new.started_rounds
      or (old.opened_at is not null and new.opened_at is distinct from old.opened_at)
      or (old.locked_at is not null and (new.locked_at is distinct from old.locked_at or new.lock_reason is distinct from old.lock_reason))
      or (old.completed_at is not null and new.completed_at is distinct from old.completed_at) then
      raise exception 'Retained Golf lifecycle facts cannot regress';
    end if;
  end if;
  split := coalesce((new.rules_snapshot #>> '{rosterPeriods,type}')='split_after_round_2'
    and (not (new.rules_snapshot ? 'sport') or new.rules_snapshot->>'sport'='golf'),false);
  if (split and new.period_key='full_tournament') or (not split and new.period_key<>'full_tournament') then raise exception 'Period does not match frozen rules'; end if;
  return new;
end;
$$;
create trigger golf_period_guard before insert or update or delete on public.golf_roster_periods
for each row execute function public.guard_golf_roster_period();
create function public.audit_golf_roster_period() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into golf_roster_period_audit(period_id,revision,facts) values(new.id,new.revision,to_jsonb(new));
  return new;
end;
$$;
create trigger golf_period_audit after insert or update on public.golf_roster_periods
for each row execute function public.audit_golf_roster_period();

alter table public.golf_roster_periods enable row level security;
alter table public.golf_roster_period_audit enable row level security;
revoke all on public.golf_roster_periods, public.golf_roster_period_audit from public,anon,authenticated,service_role;
grant select on public.golf_roster_periods, public.golf_roster_period_audit to service_role;
revoke all on function public.guard_golf_roster_period(), public.audit_golf_roster_period() from public,anon,authenticated,service_role;
-- No INSERT/UPDATE/DELETE grant and no callable write RPC. Future security-definer
-- acquisition/reconciliation RPCs must share lock order: slate, accepted version,
-- period rows ordered by id; verify expected accepted+period revisions and scope.
commit;
