-- Phase 4D.1. MANUAL EXECUTION ONLY: review and run this entire file in SQL Editor.
-- Provider-wide metadata only; no changes to slates, scoring, memberships or storage.
begin;

create table public.shotcast_events (
  pga_event_id text primary key check (pga_event_id ~ '^R[0-9]{7}$'),
  season integer not null check (season = substring(pga_event_id from 2 for 4)::integer),
  tournament_name text not null check (btrim(tournament_name) <> ''),
  espn_event_id text unique check (espn_event_id is null or btrim(espn_event_id) <> ''),
  identity_link_source text,
  schedule_evidence jsonb not null check (jsonb_typeof(schedule_evidence) = 'object'),
  inventory_evidence jsonb not null check (jsonb_typeof(inventory_evidence) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((espn_event_id is null and identity_link_source is null) or
    (espn_event_id is not null and identity_link_source is not null and btrim(identity_link_source) <> ''))
);
comment on column public.shotcast_events.espn_event_id is
  'Explicit reviewed mapping to Golf slates.external_event_id; shared across Group slates, never inferred by the registry.';

create table public.shotcast_event_courses (
  pga_event_id text not null references public.shotcast_events(pga_event_id) on delete restrict,
  pga_course_id text not null check (pga_course_id ~ '^[0-9]{1,8}$'),
  course_name text not null check (btrim(course_name) <> ''),
  relationship text not null check (relationship in ('host','alternate')),
  scoring_level text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pga_event_id,pga_course_id)
);
create unique index shotcast_event_one_host on public.shotcast_event_courses(pga_event_id) where relationship = 'host';

create table public.shotcast_player_round_courses (
  pga_event_id text not null references public.shotcast_events(pga_event_id) on delete restrict,
  pga_player_id text not null check (pga_player_id ~ '^[0-9]+$'),
  round_number integer not null check (round_number between 1 and 4),
  golf_player_id bigint references public.golf_players(id) on delete restrict,
  pga_course_id text,
  state text not null check (state in ('authoritative','unresolved')),
  source text not null check (source = 'tee-time-player-round-course'),
  unresolved_reason text,
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  observed_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (pga_event_id,pga_player_id,round_number),
  foreign key (pga_event_id,pga_course_id) references public.shotcast_event_courses(pga_event_id,pga_course_id) on delete restrict,
  check ((state = 'authoritative' and pga_course_id is not null and unresolved_reason is null) or
    (state = 'unresolved' and pga_course_id is null and unresolved_reason is not null and btrim(unresolved_reason) <> '')),
  check (state <> 'authoritative' or (
    (provenance->'teeTimes'->>'operation') is not distinct from 'GetTeeTimes' and
    (provenance->'teeTimes'->'variables'->>'id') is not distinct from pga_event_id and
    jsonb_typeof(provenance->'groups') is not distinct from 'array' and
    jsonb_array_length(provenance->'groups') > 0))
);
create index shotcast_assignments_golf_player on public.shotcast_player_round_courses(golf_player_id,pga_event_id) where golf_player_id is not null;
create index shotcast_assignments_course on public.shotcast_player_round_courses(pga_event_id,pga_course_id);

create table public.shotcast_prepared_revisions (
  preparation_id text primary key check (preparation_id ~ '^[a-f0-9]{64}$'),
  pga_event_id text not null,
  pga_course_id text not null,
  preparation_version text not null,
  package_id text not null,
  registration_profile text not null,
  engine_version text not null,
  engine_sha256 text not null check (engine_sha256 ~ '^[a-f0-9]{64}$'),
  application_sha256 text not null check (application_sha256 ~ '^[a-f0-9]{64}$'),
  configuration_sha256 text not null check (configuration_sha256 ~ '^[a-f0-9]{64}$'),
  configuration_source_sha256 text not null check (configuration_source_sha256 ~ '^[a-f0-9]{64}$'),
  asset_root text not null,
  prepared_holes integer[] not null check (cardinality(prepared_holes) between 1 and 18 and prepared_holes <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18] and array_position(prepared_holes,null) is null),
  state text not null default 'pending' check (state in ('pending','staged','validated','rejected','stale')),
  is_current boolean not null default false,
  validation_proof jsonb,
  validated_at timestamptz,
  state_reason text,
  state_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (pga_event_id,pga_course_id) references public.shotcast_event_courses(pga_event_id,pga_course_id) on delete restrict,
  check (not is_current or state = 'validated'),
  check (state not in ('rejected','stale') or (state_reason is not null and btrim(state_reason) <> '')),
  check (state <> 'validated' or (validated_at is not null and validation_proof is not null)),
  check (validation_proof is null or (
    jsonb_typeof(validation_proof) = 'object' and
    (validation_proof->>'preparationId') is not distinct from preparation_id and
    (validation_proof->>'hole') is not null and (validation_proof->>'hole')::integer = any(prepared_holes) and
    (validation_proof->>'nativeSha256') is not null and (validation_proof->>'nativeSha256') ~ '^[a-f0-9]{64}$' and
    (validation_proof->>'worldSha256') is not null and (validation_proof->>'worldSha256') ~ '^[a-f0-9]{64}$' and
    (validation_proof->'reference'->>'sha256') is not null and (validation_proof->'reference'->>'sha256') ~ '^[a-f0-9]{64}$' and
    (validation_proof->>'comparisons') is not null and (validation_proof->>'comparisons')::integer >= 3 and
    (validation_proof->>'toleranceMetres') is not null and (validation_proof->>'toleranceMetres')::numeric = 0.00000001 and
    (validation_proof->>'maximumResidualMetres') is not null and (validation_proof->>'maximumResidualMetres')::numeric between 0 and 0.00000001))
);
create index shotcast_revisions_course_state on public.shotcast_prepared_revisions(pga_event_id,pga_course_id,state);
create unique index shotcast_revision_one_current on public.shotcast_prepared_revisions(pga_event_id,pga_course_id) where is_current;
comment on column public.shotcast_prepared_revisions.validation_proof is
  'Bounded registration evidence for its hole/native-input hash. Does not imply all-hole, all-round or production-delivery readiness.';

create table public.shotcast_revision_assets (
  preparation_id text not null references public.shotcast_prepared_revisions(preparation_id) on delete restrict,
  asset_id text not null,
  role text not null check (role in ('terrain','green','image','world-file','course-data','mask')),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  source_url text not null,
  primary key (preparation_id,asset_id)
);

-- Content identities are immutable. State, approval and initial validation may change.
create function public.guard_shotcast_revision_content() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ShotCast revision metadata cannot be deleted'; end if;
  if (to_jsonb(new) - array['state','is_current','validation_proof','validated_at','state_reason','state_changed_at']) is distinct from
     (to_jsonb(old) - array['state','is_current','validation_proof','validated_at','state_reason','state_changed_at']) or
     (old.validation_proof is not null and new.validation_proof is distinct from old.validation_proof) or
     (old.validated_at is not null and new.validated_at is distinct from old.validated_at)
  then raise exception 'ShotCast revision content and existing validation evidence are immutable'; end if;
  return new;
end;
$$;
create trigger shotcast_revision_content_guard before update or delete on public.shotcast_prepared_revisions
for each row execute function public.guard_shotcast_revision_content();
create function public.guard_shotcast_revision_asset() returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then raise exception 'ShotCast asset hashes are immutable'; end if;
  if not exists (select 1 from public.shotcast_prepared_revisions where preparation_id = new.preparation_id and state in ('pending','staged'))
  then raise exception 'ShotCast assets must be registered before validation'; end if;
  return new;
end;
$$;
create trigger shotcast_revision_asset_guard before insert or update or delete on public.shotcast_revision_assets
for each row execute function public.guard_shotcast_revision_asset();

alter table public.shotcast_events enable row level security;
alter table public.shotcast_event_courses enable row level security;
alter table public.shotcast_player_round_courses enable row level security;
alter table public.shotcast_prepared_revisions enable row level security;
alter table public.shotcast_revision_assets enable row level security;
-- No direct browser access. Future callers must retain existing Group/slate authorization.
revoke all on public.shotcast_events,public.shotcast_event_courses,public.shotcast_player_round_courses,
  public.shotcast_prepared_revisions,public.shotcast_revision_assets from public,anon,authenticated;
grant select,insert,update on public.shotcast_events,public.shotcast_event_courses,public.shotcast_player_round_courses,
  public.shotcast_prepared_revisions to service_role;
grant select,insert on public.shotcast_revision_assets to service_role;
revoke all on function public.guard_shotcast_revision_content(),public.guard_shotcast_revision_asset() from public,anon,authenticated;

commit;
