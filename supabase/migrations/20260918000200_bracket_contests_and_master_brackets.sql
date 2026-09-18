-- ============================================================
-- Bracket Challenge: contests + reusable master brackets
--
-- Adds the missing separation between:
--
--   global competition
--     -> entrant-owned master bracket
--     -> reusable editable master picks
--
-- and:
--
--   Group Bracket Challenge League
--     -> contest
--     -> Group entry
--     -> immutable lock-time snapshots
--
-- This migration is additive. The original Bracket Challenge
-- foundation migration has already been applied.
-- ============================================================


-- ============================================================
-- 1. GROUP CONTESTS
--
-- A contest means one Bracket Challenge League is participating
-- in one global bracket competition.
--
-- Example:
--
--   global competition:
--     2026 College Football Playoff
--
--   contests:
--     111 -> 2026 CFP
--     Test Group -> 2026 CFP
--
-- Rules belong here because Groups may use different scoring,
-- entry limits, tiebreaker settings, or other configuration
-- while sharing the same global competition graph.
-- ============================================================

create table if not exists public.bracket_contests (
  id uuid primary key default gen_random_uuid(),

  league_id uuid not null
    references public.leagues(id)
    on delete restrict,

  competition_id bigint not null
    references public.bracket_competitions(id)
    on delete restrict,

  status text not null default 'setup'
    check (
      status in (
        'setup',
        'open',
        'locked',
        'in_progress',
        'final'
      )
    ),

  lock_at timestamptz,

  max_brackets_per_entrant integer not null default 1
    check (
      max_brackets_per_entrant between 1 and 100
    ),

  rules_version integer not null default 1
    check (
      rules_version >= 1
    ),

  rules_snapshot jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(rules_snapshot) = 'object'
    ),

  metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(metadata) = 'object'
    ),

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  constraint bracket_contests_league_competition_key
    unique (
      league_id,
      competition_id
    ),

  constraint bracket_contests_id_competition_key
    unique (
      id,
      competition_id
    )
);

create index if not exists
  bracket_contests_competition_idx
on public.bracket_contests (
  competition_id,
  league_id
);


-- ============================================================
-- 2. CONTEST LEAGUE VALIDATION
--
-- Only a League belonging to the permanent Bracket Challenge
-- game may host a bracket contest.
-- ============================================================

create or replace function public.validate_bracket_contest_league()
returns trigger
language plpgsql
as $$
declare
  league_sport_key text;
begin
  select l.sport_key
    into league_sport_key
  from public.leagues l
  where l.id = new.league_id;

  if league_sport_key is null then
    raise exception
      'Bracket contest League % does not exist.',
      new.league_id;
  end if;

  if league_sport_key <> 'bracket_challenge' then
    raise exception
      'Bracket contests require a bracket_challenge League.';
  end if;

  return new;
end;
$$;

drop trigger if exists
  validate_bracket_contest_league_trigger
on public.bracket_contests;

create trigger
  validate_bracket_contest_league_trigger
before insert or update of league_id
on public.bracket_contests
for each row
execute function public.validate_bracket_contest_league();


-- ============================================================
-- 3. MASTER BRACKETS
--
-- A master bracket belongs to an entrant and a global
-- competition, NOT to a Group.
--
-- This is the reusable bracket the entrant fills out once.
--
-- bracket_number supports multiple brackets for the same
-- entrant/competition without making Group membership part of
-- bracket identity.
--
-- Example:
--
--   Mark
--     2026 CFP
--       Bracket #1
--       Bracket #2
--
-- Either master bracket may later be entered into one or more
-- compatible Group contests.
-- ============================================================

create table if not exists public.bracket_master_brackets (
  id uuid primary key default gen_random_uuid(),

  competition_id bigint not null
    references public.bracket_competitions(id)
    on delete restrict,

  entrant_id uuid not null
    references public.bracket_entrants(id)
    on delete restrict,

  bracket_number integer not null default 1
    check (
      bracket_number >= 1
    ),

  name text
    check (
      name is null
      or char_length(trim(name))
        between 1 and 80
    ),

  status text not null default 'draft'
    check (
      status in (
        'draft',
        'submitted',
        'locked',
        'final'
      )
    ),

  tiebreaker_value integer
    check (
      tiebreaker_value is null
      or tiebreaker_value >= 0
    ),

  submitted_at timestamptz,

  locked_at timestamptz,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  constraint bracket_master_brackets_entrant_number_key
    unique (
      competition_id,
      entrant_id,
      bracket_number
    ),

  constraint bracket_master_brackets_id_competition_key
    unique (
      id,
      competition_id
    )
);

create index if not exists
  bracket_master_brackets_entrant_idx
on public.bracket_master_brackets (
  entrant_id,
  competition_id
);


-- ============================================================
-- 4. MASTER PICKS
--
-- These are the normalized EDITABLE selections belonging to
-- the reusable master bracket.
--
-- Group entries will snapshot these selections at lock time.
-- ============================================================

create table if not exists public.bracket_master_picks (
  id bigint generated by default as identity primary key,

  master_bracket_id uuid not null,

  competition_id bigint not null,

  game_id bigint not null,

  picked_team_id text not null,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  constraint bracket_master_picks_bracket_game_key
    unique (
      master_bracket_id,
      game_id
    ),

  constraint bracket_master_picks_bracket_competition_fk
    foreign key (
      master_bracket_id,
      competition_id
    )
    references public.bracket_master_brackets (
      id,
      competition_id
    )
    on delete cascade,

  constraint bracket_master_picks_game_competition_fk
    foreign key (
      game_id,
      competition_id
    )
    references public.bracket_games (
      id,
      competition_id
    )
    on delete restrict
);

create index if not exists
  bracket_master_picks_bracket_idx
on public.bracket_master_picks (
  master_bracket_id
);

create index if not exists
  bracket_master_picks_game_idx
on public.bracket_master_picks (
  game_id
);


-- ============================================================
-- 5. CONNECT GROUP ENTRIES TO CONTESTS + MASTER BRACKETS
--
-- Existing bracket_entries remain the Group-scoped scoring
-- object.
--
-- New entries will identify:
--
--   contest_id
--   master_bracket_id
--
-- while retaining competition_id / league_id / entrant_id as
-- explicit snapshot/scoping columns.
--
-- Columns are nullable in this additive migration so the
-- original table remains migration-safe. Runtime code should
-- require them for the new Bracket Challenge workflow.
-- ============================================================

alter table public.bracket_entries
  add column if not exists contest_id uuid;

alter table public.bracket_entries
  add column if not exists master_bracket_id uuid;


alter table public.bracket_entries
  drop constraint if exists
    bracket_entries_contest_competition_fk;

alter table public.bracket_entries
  add constraint
    bracket_entries_contest_competition_fk
  foreign key (
    contest_id,
    competition_id
  )
  references public.bracket_contests (
    id,
    competition_id
  )
  on delete restrict;


alter table public.bracket_entries
  drop constraint if exists
    bracket_entries_master_competition_fk;

alter table public.bracket_entries
  add constraint
    bracket_entries_master_competition_fk
  foreign key (
    master_bracket_id,
    competition_id
  )
  references public.bracket_master_brackets (
    id,
    competition_id
  )
  on delete restrict;


create index if not exists
  bracket_entries_contest_idx
on public.bracket_entries (
  contest_id
);

create index if not exists
  bracket_entries_master_bracket_idx
on public.bracket_entries (
  master_bracket_id
);


-- ============================================================
-- 6. MULTIPLE BRACKETS PER ENTRANT / GROUP CONTEST
--
-- The original foundation allowed exactly one entry per:
--
--   League + competition + entrant
--
-- That prevents an entrant from submitting Bracket #2.
--
-- Replace it with one entry per:
--
--   contest + master bracket
--
-- The master bracket already owns entrant identity.
-- ============================================================

alter table public.bracket_entries
  drop constraint if exists
    bracket_entries_league_competition_entrant_key;

create unique index if not exists
  bracket_entries_contest_master_key
on public.bracket_entries (
  contest_id,
  master_bracket_id
)
where
  contest_id is not null
  and master_bracket_id is not null;


-- ============================================================
-- 7. ENTRY CONSISTENCY VALIDATION
--
-- Foreign keys guarantee competition consistency, but they do
-- not by themselves guarantee that:
--
--   entry.league_id == contest.league_id
--   entry.entrant_id == master bracket entrant_id
--
-- Enforce those invariants here.
-- ============================================================

create or replace function public.validate_bracket_entry_relationships()
returns trigger
language plpgsql
as $$
declare
  contest_league_id uuid;
  master_entrant_id uuid;
begin
  if new.contest_id is not null then
    select c.league_id
      into contest_league_id
    from public.bracket_contests c
    where c.id = new.contest_id
      and c.competition_id = new.competition_id;

    if contest_league_id is null then
      raise exception
        'Bracket entry contest does not match competition.';
    end if;

    if contest_league_id <> new.league_id then
      raise exception
        'Bracket entry League does not match contest League.';
    end if;
  end if;

  if new.master_bracket_id is not null then
    select mb.entrant_id
      into master_entrant_id
    from public.bracket_master_brackets mb
    where mb.id = new.master_bracket_id
      and mb.competition_id = new.competition_id;

    if master_entrant_id is null then
      raise exception
        'Bracket entry master bracket does not match competition.';
    end if;

    if master_entrant_id <> new.entrant_id then
      raise exception
        'Bracket entry entrant does not own master bracket.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists
  validate_bracket_entry_relationships_trigger
on public.bracket_entries;

create trigger
  validate_bracket_entry_relationships_trigger
before insert or update of
  contest_id,
  master_bracket_id,
  competition_id,
  league_id,
  entrant_id
on public.bracket_entries
for each row
execute function public.validate_bracket_entry_relationships();


-- ============================================================
-- 8. RLS
--
-- Keep the same server-mediated model as the original Bracket
-- Challenge foundation. No permissive direct-client policies.
-- ============================================================

alter table public.bracket_contests
  enable row level security;

alter table public.bracket_master_brackets
  enable row level security;

alter table public.bracket_master_picks
  enable row level security;


-- ============================================================
-- 9. COMMENTS
-- ============================================================

comment on table public.bracket_contests is
  'Group-specific participation/configuration for one global Bracket Challenge competition.';

comment on table public.bracket_master_brackets is
  'Reusable entrant-owned bracket for a global competition, independent of Group contests.';

comment on table public.bracket_master_picks is
  'Editable normalized picks belonging to a reusable master bracket.';

comment on column public.bracket_entries.contest_id is
  'Group contest into which this immutable scoring entry was submitted.';

comment on column public.bracket_entries.master_bracket_id is
  'Reusable master bracket from which this Group entry was snapshotted.';
