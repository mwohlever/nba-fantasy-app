-- PROPOSAL ONLY: isolated rehearsal, never a production migration runner input.
-- Dependencies: existing catalogs, scoped slates, and fantasy_draft_history.sql.
-- No existing reader/writer changes. All new write RPCs remain owner-only.
begin;
set local search_path = pg_catalog, public;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
do $$ begin
  if current_setting('sports111.factual_schema_approval',true) is distinct from 'rehearsal:rosters_pools_v1' then
    raise exception 'Reviewed isolated roster/pool rehearsal required';
  end if;
end $$;

create table public.professional_player_roster_evidence (
  id uuid primary key,
  sport text not null check (sport in ('nba','nfl')),
  nba_player_id bigint references public.players(id) on delete restrict,
  nfl_player_id bigint references public.players_nfl(id) on delete restrict,
  player_id bigint generated always as (coalesce(nba_player_id,nfl_player_id)) stored,
  entity_kind text not null check (entity_kind in ('athlete','team_defense')),
  season integer not null check (season between 2000 and 2100),
  evidence_type text not null check (evidence_type in ('snapshot','interval')),
  effective_from timestamptz,
  effective_to timestamptz,
  observed_at timestamptz not null,
  verified_through timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  roster_status text not null check (roster_status in ('rostered','unrostered','unresolved')),
  confidence text not null check (confidence in ('confirmed','uncertain')),
  team_provider text check (team_provider in ('nba','espn')),
  team_provider_id text check (team_provider_id ~ '^[1-9][0-9]*$'),
  team_abbreviation text,
  position text check(position is null or (sport='nba' and position in ('PG','SG','G','SF','PF','C','F','F/C','FC'))
    or (sport='nfl' and position in ('QB','RB','WR','TE','K','D/ST'))),
  -- [{url,sha256,captured_at}]. Facts may conflict; retain both source claims.
  sources jsonb not null check (jsonb_typeof(sources)='array' and jsonb_array_length(sources) between 1 and 20),
  supersedes_id uuid unique references public.professional_player_roster_evidence(id) on delete restrict,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  unique(id,sport,player_id,entity_kind),
  check ((sport='nba' and nba_player_id is not null and nfl_player_id is null and entity_kind='athlete')
    or (sport='nfl' and nfl_player_id is not null and nba_player_id is null)),
  check ((team_provider is null)=(team_provider_id is null)),
  check ((roster_status='rostered' and team_provider is not null and position is not null)
    or (roster_status<>'rostered' and team_provider is null and team_abbreviation is null and position is null)),
  check (verified_through<=observed_at and observed_at<=recorded_at),
  check ((evidence_type='snapshot' and effective_from is null and effective_to is null and verified_through=observed_at)
    or (evidence_type='interval' and effective_from is not null and effective_from<=verified_through
      and (effective_to is null or (effective_to>effective_from and verified_through<=effective_to))))
);
create index professional_roster_lookup on public.professional_player_roster_evidence(sport,season,player_id,recorded_at);

create function public.reject_factual_phase2_mutation() returns trigger language plpgsql as $$
begin raise exception 'Factual evidence and frozen pools are immutable'; end $$;
create trigger professional_roster_immutable before update or delete on public.professional_player_roster_evidence
  for each row execute function public.reject_factual_phase2_mutation();

create function public.propose_append_roster_evidence(p jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public set timezone='UTC' as $$
declare r public.professional_player_roster_evidence%rowtype; previous public.professional_player_roster_evidence%rowtype;
  body jsonb; digest text; src jsonb; provider_id bigint;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>32768
    or exists(select 1 from jsonb_object_keys(p) k where k not in
      ('id','sport','nba_player_id','nfl_player_id','entity_kind','season','evidence_type','effective_from','effective_to',
       'observed_at','verified_through','roster_status','confidence','team_provider','team_provider_id','team_abbreviation','position','sources','supersedes_id')) then
    raise exception 'Invalid roster evidence contract';
  end if;
  r := jsonb_populate_record(null::public.professional_player_roster_evidence,p);
  r.recorded_at:=clock_timestamp();
  body:=to_jsonb(r)-array['recorded_at','payload_hash','player_id'];
  digest:=encode(sha256(convert_to(body::text,'UTF8')),'hex');
  if r.id is null or r.sport is null or coalesce(r.nba_player_id,r.nfl_player_id) is null then raise exception 'Roster identity required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('roster',r.sport,coalesce(r.nba_player_id,r.nfl_player_id),r.season)::text,0));
  select * into previous from public.professional_player_roster_evidence where id=r.id;
  if found then
    if previous.payload_hash<>digest then raise exception 'Roster receipt ID reused with different evidence'; end if;
    return previous.id;
  end if;
  if r.supersedes_id is not null and not exists(select 1 from public.professional_player_roster_evidence e
    where e.id=r.supersedes_id and e.sport=r.sport and e.player_id=coalesce(r.nba_player_id,r.nfl_player_id) and e.season=r.season
      and not exists(select 1 from public.professional_player_roster_evidence n where n.supersedes_id=e.id)) then
    raise exception 'Supersession must target the current claim for the same permanent player and season';
  end if;
  for src in select value from jsonb_array_elements(r.sources) loop
    if jsonb_typeof(src) is distinct from 'object' or (src->>'url' ~ '^https://') is distinct from true
      or (src->>'sha256' ~ '^[a-f0-9]{64}$') is distinct from true or src->>'captured_at' is null
      or (src->>'captured_at')::timestamptz>r.observed_at then raise exception 'Invalid roster provenance'; end if;
  end loop;
  if r.sport='nfl' then
    select nfl_player_id into provider_id from public.players_nfl where id=r.nfl_player_id;
    if not found or provider_id is null then raise exception 'Unknown permanent NFL provider identity'; end if;
    if (r.entity_kind='team_defense') is distinct from (provider_id>=100000000) or
      (r.entity_kind='team_defense' and r.roster_status='rostered' and
        (r.position<>'D/ST' or r.team_provider<>'espn' or r.team_provider_id<>(provider_id-100000000)::text)) then
      raise exception 'NFL team defense must retain its synthetic team identity';
    end if;
  end if;
  insert into public.professional_player_roster_evidence(id,sport,nba_player_id,nfl_player_id,entity_kind,season,evidence_type,
    effective_from,effective_to,observed_at,verified_through,recorded_at,roster_status,confidence,team_provider,team_provider_id,
    team_abbreviation,position,sources,supersedes_id,payload_hash)
  values(r.id,r.sport,r.nba_player_id,r.nfl_player_id,r.entity_kind,r.season,r.evidence_type,r.effective_from,r.effective_to,
    r.observed_at,r.verified_through,r.recorded_at,r.roster_status,r.confidence,r.team_provider,r.team_provider_id,
    r.team_abbreviation,r.position,r.sources,r.supersedes_id,digest);
  return r.id;
end $$;

-- No extrapolation from two snapshots, no current catalog/team/appearance fallback.
-- Both source observation time AND actual database knowledge time must precede cutoff.
create function public.propose_resolve_roster(p_sport text,p_player bigint,p_season integer,p_effective timestamptz,p_cutoff timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public set timezone='UTC' as $$
declare claims jsonb; n integer;
begin
  if p_sport not in ('nba','nfl') or p_effective is null or p_cutoff is null then raise exception 'Invalid roster resolution scope'; end if;
  select count(*) into n from public.professional_player_roster_evidence where sport=p_sport and player_id=p_player and season=p_season;
  if n>1000 then raise exception 'Roster history exceeds reviewed per-player bound'; end if;
  select jsonb_agg(to_jsonb(e) order by e.recorded_at,e.id) into claims
  from public.professional_player_roster_evidence e
  where e.sport=p_sport and e.player_id=p_player and e.season=p_season and e.recorded_at<=p_cutoff and e.observed_at<=p_cutoff
    and not exists(select 1 from public.professional_player_roster_evidence s where s.supersedes_id=e.id and s.recorded_at<=p_cutoff and s.observed_at<=p_cutoff)
    and ((e.evidence_type='snapshot' and p_effective=e.observed_at) or (e.evidence_type='interval' and p_effective>=e.effective_from
      and p_effective<=e.verified_through and (e.effective_to is null or p_effective<e.effective_to)));
  if claims is null then return jsonb_build_object('state','unresolved','reason','no_effective_evidence'); end if;
  if exists(select 1 from jsonb_array_elements(claims) c where c->>'confidence'<>'confirmed' or c->>'roster_status'='unresolved') then
    return jsonb_build_object('state','unresolved','reason','uncertain_evidence','claims',claims);
  end if;
  if (select count(distinct c->'roster_status'||jsonb_build_array(c->'team_provider',c->'team_provider_id',c->'position',c->'entity_kind')) from jsonb_array_elements(claims) c)>1 then
    return jsonb_build_object('state','conflict','reason','conflicting_evidence','claims',claims);
  end if;
  return jsonb_build_object('state',claims->0->>'roster_status','claim',claims->0,'claims',claims);
end $$;

-- Header absence is explicit legacy_unfrozen/requires_review, never an empty pool.
create table public.slate_player_pool_snapshots (
  slate_id bigint primary key references public.slates(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  league_id uuid not null references public.leagues(id) on delete restrict,
  sport text not null check(sport in ('nba','nfl')),
  professional_season integer not null check(professional_season between 2000 and 2100),
  eligibility_effective_at timestamptz not null,
  roster_evidence_cutoff timestamptz not null,
  frozen_at timestamptz not null default clock_timestamp(),
  pool_version integer not null check(pool_version=1),
  pool_hash text not null check(pool_hash ~ '^[a-f0-9]{64}$'),
  catalog_hash text not null check(catalog_hash ~ '^[a-f0-9]{64}$'),
  member_count integer not null check(member_count between 0 and 3000),
  rules_snapshot jsonb not null,
  on_slate_teams jsonb not null check(jsonb_typeof(on_slate_teams)='array'),
  unique(slate_id,sport),
  check(roster_evidence_cutoff<=frozen_at)
);
create table public.slate_player_eligibility (
  slate_id bigint not null,
  sport text not null,
  nba_player_id bigint references public.players(id) on delete restrict,
  nfl_player_id bigint references public.players_nfl(id) on delete restrict,
  player_id bigint generated always as(coalesce(nba_player_id,nfl_player_id)) stored,
  entity_kind text not null check(entity_kind in ('athlete','team_defense')),
  saved_position text not null,
  team_provider text not null check(team_provider in ('nba','espn')),
  team_provider_id text not null check(team_provider_id ~ '^[1-9][0-9]*$'),
  saved_team_abbreviation text,
  on_slate boolean not null,
  roster_evidence_id uuid not null,
  primary key(slate_id,player_id),
  foreign key(roster_evidence_id,sport,player_id,entity_kind)
    references public.professional_player_roster_evidence(id,sport,player_id,entity_kind) on delete restrict,
  foreign key(slate_id,sport) references public.slate_player_pool_snapshots(slate_id,sport) on delete restrict deferrable initially deferred,
  check((sport='nba' and nba_player_id is not null and nfl_player_id is null and entity_kind='athlete')
    or (sport='nfl' and nfl_player_id is not null and nba_player_id is null))
);
create trigger slate_pool_immutable before update or delete on public.slate_player_pool_snapshots
  for each row execute function public.reject_factual_phase2_mutation();
create trigger slate_pool_members_immutable before update or delete on public.slate_player_eligibility
  for each row execute function public.reject_factual_phase2_mutation();

create function public.guard_player_pool_insert() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  -- Same parent lock for admission and membership insert, including direct owner
  -- rehearsal writes. Members are inserted before the final immutable header.
  perform 1 from public.slates where id=new.slate_id for update;
  if tg_table_name='slate_player_eligibility' then
    if exists(select 1 from public.slate_player_pool_snapshots where slate_id=new.slate_id) then
      raise exception 'Frozen pool cannot admit late members'; end if;
  else
    if not exists(select 1 from public.slates s join public.leagues l on l.id=s.league_id where s.id=new.slate_id
      and s.league_id=new.league_id and l.group_id=new.group_id and s.sport=new.sport and l.sport_key=new.sport
      and s.rules_snapshot=new.rules_snapshot) or new.member_count<>(select count(*) from public.slate_player_eligibility where slate_id=new.slate_id) then
      raise exception 'Pool scope or complete membership mismatch'; end if;
  end if;
  return new;
end $$;
create trigger slate_pool_member_insert_guard before insert on public.slate_player_eligibility
  for each row execute function public.guard_player_pool_insert();
create trigger slate_pool_header_insert_guard before insert on public.slate_player_pool_snapshots
  for each row execute function public.guard_player_pool_insert();

create function public.guard_frozen_player_pool() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.slate_player_pool_snapshots where slate_id=old.id) and
    (tg_op='DELETE' or jsonb_build_array(new.league_id,new.sport,new.rules_snapshot,new.rules_version,
      to_jsonb(new)->'date',to_jsonb(new)->'start_date',to_jsonb(new)->'end_date',to_jsonb(new)->'first_game_start_time',to_jsonb(new)->'nba_team_abbreviations') is distinct from
      jsonb_build_array(old.league_id,old.sport,old.rules_snapshot,old.rules_version,to_jsonb(old)->'date',to_jsonb(old)->'start_date',
        to_jsonb(old)->'end_date',to_jsonb(old)->'first_game_start_time',to_jsonb(old)->'nba_team_abbreviations')) then
    raise exception 'Frozen slate scope/rules/window require a new slate';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger frozen_player_pool_slate_guard before update or delete on public.slates
  for each row execute function public.guard_frozen_player_pool();

create function public.guard_frozen_pool_league_scope() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if row(new.group_id,new.sport_key) is distinct from row(old.group_id,old.sport_key)
    and exists(select 1 from public.slate_player_pool_snapshots where league_id=old.id) then
    raise exception 'Frozen player pools preserve league Group/sport ownership';
  end if;
  return new;
end $$;
create trigger frozen_pool_league_scope_guard before update on public.leagues
  for each row execute function public.guard_frozen_pool_league_scope();

create function public.propose_freeze_slate_pool(p_slate bigint,p_group uuid,p_league uuid,p_sport text,
  p_season integer,p_effective timestamptz,p_cutoff timestamptz,p_on_slate jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public set timezone='UTC' as $$
declare s public.slates%rowtype; h public.slate_player_pool_snapshots%rowtype; ids bigint[]; pid bigint; r jsonb; c jsonb;
  members jsonb:='[]'; cat_hash text; digest text; slots jsonb;
begin
  select * into s from public.slates where id=p_slate for update;
  if not found or s.league_id<>p_league or s.sport<>p_sport or not exists(select 1 from public.leagues
    where id=p_league and group_id=p_group and sport_key=p_sport) then raise exception 'Pool outside Group/league/sport scope'; end if;
  select * into h from public.slate_player_pool_snapshots where slate_id=p_slate;
  if found then
    if row(h.professional_season,h.eligibility_effective_at,h.roster_evidence_cutoff,h.on_slate_teams)
      is distinct from row(p_season,p_effective,p_cutoff,p_on_slate) then raise exception 'Existing pool parameters differ'; end if;
    return to_jsonb(h); -- Frozen unlocked/locked pools never consult current roster again.
  end if;
  if s.is_locked or exists(select 1 from public.fantasy_drafts where slate_id=p_slate)
    or exists(select 1 from public.lineups l join public.lineup_players lp on lp.lineup_id=l.id where l.slate_id=p_slate) then
    raise exception 'Legacy/populated slate requires reviewed compatibility path';
  end if;
  slots:=s.rules_snapshot#>'{roster,slots}';
  if jsonb_typeof(slots) is distinct from 'array' or jsonb_array_length(slots)=0 or p_effective is null or p_cutoff is null
    or p_cutoff>clock_timestamp() or jsonb_typeof(p_on_slate) is distinct from 'array' or jsonb_array_length(p_on_slate)>64 then
    raise exception 'Reviewed rules, cutoffs and optional On Slate evidence required';
  end if;
  if exists(select 1 from jsonb_array_elements(slots) slot where jsonb_typeof(slot) is distinct from 'object'
    or (slot->>'slotCount' ~ '^[0-9]+$') is distinct from true or coalesce(slot->>'position','')='') then
    raise exception 'Invalid frozen roster slot contract'; end if;
  if exists(select 1 from jsonb_array_elements(p_on_slate) t where jsonb_typeof(t) is distinct from 'object'
    or coalesce(t->>'provider','') not in ('nba','espn') or (t->>'id' ~ '^[1-9][0-9]*$') is distinct from true) then
    raise exception 'Invalid On Slate team namespace'; end if;
  -- Serialize with evidence/catalog writes. Under repeatable-read a caller must retry
  -- from a fresh transaction after conflict; admission is intended for READ COMMITTED.
  if p_sport='nba' then
    lock table public.players in share mode;
    select array_agg(id order by id) into ids from (select id from public.players order by id limit 3001) x;
  else
    lock table public.players_nfl in share mode;
    select array_agg(id order by id) into ids from (select id from public.players_nfl order by id limit 3001) x;
  end if;
  lock table public.professional_player_roster_evidence in share mode;
  if cardinality(ids)>3000 or coalesce(cardinality(ids),0)=0 then raise exception 'Catalog exceeds reviewed bound or is empty'; end if;
  cat_hash:=encode(sha256(convert_to(to_jsonb(ids)::text,'UTF8')),'hex');
  foreach pid in array ids loop
    r:=public.propose_resolve_roster(p_sport,pid,p_season,p_effective,p_cutoff);
    if r->>'state' not in ('rostered','unrostered') then raise exception 'Incomplete eligibility for %:%: %',p_sport,pid,r->>'state'; end if;
    c:=r->'claim';
    if r->>'state'='rostered' and exists(select 1 from jsonb_array_elements(slots) slot
      where (slot->>'slotCount')::integer>0 and public.fantasy_slot_eligible(p_sport,c->>'position',slot->>'position')) then
      members:=members||jsonb_build_array(jsonb_build_object('player_id',pid,'kind',c->>'entity_kind','position',c->>'position',
        'team_provider',c->>'team_provider','team_id',c->>'team_provider_id','team_abbreviation',c->>'team_abbreviation',
        'evidence_id',c->>'id','on_slate',exists(select 1 from jsonb_array_elements(p_on_slate) t
          where t->>'provider'=c->>'team_provider' and t->>'id'=c->>'team_provider_id')));
    end if;
  end loop;
  digest:=encode(sha256(convert_to(jsonb_build_array(1,p_slate,p_group,p_league,p_sport,p_season,p_effective,p_cutoff,
    cat_hash,s.rules_snapshot,p_on_slate,members)::text,'UTF8')),'hex');
  insert into public.slate_player_eligibility(slate_id,sport,nba_player_id,nfl_player_id,entity_kind,saved_position,
    team_provider,team_provider_id,saved_team_abbreviation,on_slate,roster_evidence_id)
  select p_slate,p_sport,case when p_sport='nba' then (m->>'player_id')::bigint end,
    case when p_sport='nfl' then (m->>'player_id')::bigint end,m->>'kind',m->>'position',m->>'team_provider',m->>'team_id',
    m->>'team_abbreviation',(m->>'on_slate')::boolean,(m->>'evidence_id')::uuid from jsonb_array_elements(members) m;
  insert into public.slate_player_pool_snapshots(slate_id,group_id,league_id,sport,professional_season,eligibility_effective_at,
    roster_evidence_cutoff,pool_version,pool_hash,catalog_hash,member_count,rules_snapshot,on_slate_teams)
  values(p_slate,p_group,p_league,p_sport,p_season,p_effective,p_cutoff,1,digest,cat_hash,jsonb_array_length(members),s.rules_snapshot,p_on_slate)
  returning * into h;
  return to_jsonb(h);
end $$;

-- Read proposal only: existing access checks must wrap this in a future coordinated release.
create function public.propose_read_slate_pool(p_slate bigint,p_group uuid,p_league uuid,p_sport text)
returns jsonb language sql stable security definer set search_path=pg_catalog,public set timezone='UTC' as $$
  select case when h.slate_id is null then jsonb_build_object('state','legacy_requires_review')
    else jsonb_build_object('state','frozen','header',to_jsonb(h),'players',coalesce(
      (select jsonb_agg(to_jsonb(m) order by m.player_id) from public.slate_player_eligibility m where m.slate_id=s.id),'[]')) end
  from public.slates s join public.leagues l on l.id=s.league_id left join public.slate_player_pool_snapshots h on h.slate_id=s.id
  where s.id=p_slate and s.league_id=p_league and s.sport=p_sport and l.group_id=p_group and l.sport_key=p_sport;
$$;

alter table public.professional_player_roster_evidence enable row level security;
alter table public.slate_player_pool_snapshots enable row level security;
alter table public.slate_player_eligibility enable row level security;
revoke all on public.professional_player_roster_evidence,public.slate_player_pool_snapshots,public.slate_player_eligibility from public,anon,authenticated,service_role;
grant select on public.professional_player_roster_evidence,public.slate_player_pool_snapshots,public.slate_player_eligibility to service_role;
revoke all on function public.reject_factual_phase2_mutation(),public.propose_append_roster_evidence(jsonb),
  public.propose_resolve_roster(text,bigint,integer,timestamptz,timestamptz),public.guard_frozen_player_pool(),public.guard_player_pool_insert(),
  public.guard_frozen_pool_league_scope(),
  public.propose_freeze_slate_pool(bigint,uuid,uuid,text,integer,timestamptz,timestamptz,jsonb),
  public.propose_read_slate_pool(bigint,uuid,uuid,text) from public,anon,authenticated,service_role;
commit;
