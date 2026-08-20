-- ============================================================
-- 111 SPORTS — GROUPS PLATFORM FOUNDATION
-- Checkpoint 1
--
-- Additive/backward-compatible foundation only.
-- Existing production behavior remains unchanged.
-- ============================================================

begin;


-- ============================================================
-- 1. ACCOUNT-LEVEL SYSTEM ROLE
--
-- Keep the existing app_users.role + PIN fields untouched for
-- the legacy application. system_role is the future global
-- permission level and is NOT yet used by runtime auth.
-- ============================================================

alter table public.app_users
  add column if not exists system_role text
  not null
  default 'user';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_system_role_check'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_system_role_check
      check (
        system_role in (
          'user',
          'super_admin'
        )
      );
  end if;
end
$$;


-- ============================================================
-- 2. GROUPS
-- ============================================================

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  slug text not null,

  created_by_user_id uuid
    references public.app_users(id)
    on delete set null,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint groups_name_check
    check (
      char_length(trim(name))
      between 1 and 80
    ),

  constraint groups_slug_check
    check (
      slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    )
);

create unique index if not exists
  groups_slug_unique
on public.groups (
  lower(slug)
);

create index if not exists
  groups_created_by_user_id_idx
on public.groups (
  created_by_user_id
);


-- ============================================================
-- 3. GROUP MEMBERSHIPS
--
-- Group-level permission:
--   member
--   admin
--
-- Super Admin remains account-level on app_users.
-- ============================================================

create table if not exists public.group_memberships (
  id uuid primary key default gen_random_uuid(),

  group_id uuid not null
    references public.groups(id)
    on delete cascade,

  user_id uuid not null
    references public.app_users(id)
    on delete cascade,

  role text not null default 'member'
    check (
      role in (
        'member',
        'admin'
      )
    ),

  is_active boolean not null default true,

  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint group_memberships_group_user_unique
    unique (
      group_id,
      user_id
    )
);

create index if not exists
  group_memberships_user_id_idx
on public.group_memberships (
  user_id
);

create index if not exists
  group_memberships_group_active_idx
on public.group_memberships (
  group_id,
  is_active
);


-- ============================================================
-- 4. LEAGUES
--
-- Group = people
-- League = game/sport inside the Group
--
-- game_mode allows multiple implementations of one sport,
-- e.g. Golf standard_draft vs budget_best_ball.
-- ============================================================

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),

  group_id uuid not null
    references public.groups(id)
    on delete cascade,

  sport_key text not null
    check (
      sport_key in (
        'nba',
        'nfl',
        'golf',
        'ncaa_pickem',
        'nba_skins'
      )
    ),

  game_mode text not null default 'standard',

  name text not null,
  slug text not null,

  is_enabled boolean not null default true,

  settings_version integer not null default 1
    check (
      settings_version >= 1
    ),

  settings jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(settings) = 'object'
    ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leagues_group_sport_mode_unique
    unique (
      group_id,
      sport_key,
      game_mode
    ),

  constraint leagues_group_slug_unique
    unique (
      group_id,
      slug
    ),

  constraint leagues_name_check
    check (
      char_length(trim(name))
      between 1 and 80
    ),

  constraint leagues_slug_check
    check (
      slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    )
);

create index if not exists
  leagues_group_enabled_idx
on public.leagues (
  group_id,
  is_enabled
);


-- ============================================================
-- 5. GROUP INVITES
--
-- Invite-only signup for Groups v1.
-- Store only a token hash, never the raw invite token.
-- ============================================================

create table if not exists public.group_invites (
  id uuid primary key default gen_random_uuid(),

  group_id uuid not null
    references public.groups(id)
    on delete cascade,

  email text not null,

  token_hash text not null unique,

  status text not null default 'pending'
    check (
      status in (
        'pending',
        'accepted',
        'revoked',
        'expired'
      )
    ),

  invited_by_user_id uuid
    references public.app_users(id)
    on delete set null,

  accepted_by_user_id uuid
    references public.app_users(id)
    on delete set null,

  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint group_invites_email_check
    check (
      char_length(trim(email))
      between 3 and 320
    )
);

create index if not exists
  group_invites_group_id_idx
on public.group_invites (
  group_id
);

create index if not exists
  group_invites_email_idx
on public.group_invites (
  lower(email)
);

create unique index if not exists
  group_invites_pending_group_email_unique
on public.group_invites (
  group_id,
  lower(email)
)
where status = 'pending';


-- ============================================================
-- 6. EVOLVE TEAMS INTO GROUP-SPECIFIC FANTASY IDENTITIES
--
-- Existing team_id relationships remain intact.
-- app_users.team_id remains intact for the legacy runtime.
-- ============================================================

alter table public.teams
  add column if not exists group_id uuid;

alter table public.teams
  add column if not exists user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'teams_group_id_fkey'
      and conrelid = 'public.teams'::regclass
  ) then
    alter table public.teams
      add constraint teams_group_id_fkey
      foreign key (group_id)
      references public.groups(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'teams_user_id_fkey'
      and conrelid = 'public.teams'::regclass
  ) then
    alter table public.teams
      add constraint teams_user_id_fkey
      foreign key (user_id)
      references public.app_users(id)
      on delete set null;
  end if;
end
$$;

create index if not exists
  teams_group_id_idx
on public.teams (
  group_id
);

create index if not exists
  teams_user_id_idx
on public.teams (
  user_id
);

create unique index if not exists
  teams_group_user_unique
on public.teams (
  group_id,
  user_id
)
where
  group_id is not null
  and user_id is not null;


/*
 * Do NOT remove teams_name_key yet.
 *
 * The current production app still operates on one global team
 * namespace. We will replace that global uniqueness with
 * group-scoped uniqueness when the runtime becomes Group-aware.
 */


-- ============================================================
-- 7. ADD LEAGUE OWNERSHIP TO CURRENT GAME CONTAINERS
--
-- Child rows continue deriving scope through their parent.
-- We intentionally do NOT add group_id/league_id to every
-- lineup, result, stat, or hole table.
-- ============================================================

alter table public.slates
  add column if not exists league_id uuid;

alter table public.nba_skins_seasons
  add column if not exists league_id uuid;

alter table public.ncaa_pickem_weeks
  add column if not exists league_id uuid;


do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'slates_league_id_fkey'
      and conrelid = 'public.slates'::regclass
  ) then
    alter table public.slates
      add constraint slates_league_id_fkey
      foreign key (league_id)
      references public.leagues(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'nba_skins_seasons_league_id_fkey'
      and conrelid = 'public.nba_skins_seasons'::regclass
  ) then
    alter table public.nba_skins_seasons
      add constraint nba_skins_seasons_league_id_fkey
      foreign key (league_id)
      references public.leagues(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'ncaa_pickem_weeks_league_id_fkey'
      and conrelid = 'public.ncaa_pickem_weeks'::regclass
  ) then
    alter table public.ncaa_pickem_weeks
      add constraint ncaa_pickem_weeks_league_id_fkey
      foreign key (league_id)
      references public.leagues(id)
      on delete restrict;
  end if;
end
$$;


create index if not exists
  slates_league_id_idx
on public.slates (
  league_id
);

create index if not exists
  nba_skins_seasons_league_id_idx
on public.nba_skins_seasons (
  league_id
);

create index if not exists
  ncaa_pickem_weeks_league_id_idx
on public.ncaa_pickem_weeks (
  league_id
);


/*
 * Existing global uniqueness constraints remain temporarily:
 *
 *   teams.name
 *   slates(sport, external_event_id)
 *   nba_skins_seasons.season
 *   ncaa_pickem_weeks(season, week_number)
 *
 * They protect the still-live legacy runtime.
 *
 * We will replace them with League-scoped uniqueness immediately
 * before multiple Groups can create game data.
 */


-- ============================================================
-- 8. IDENTIFY MARK / SUPER ADMIN
--
-- Fail the entire transaction if exactly one Mark account cannot
-- be identified. We do not silently guess the Super Admin.
-- ============================================================

do $$
declare
  mark_count integer;
  mark_user_id uuid;
begin
  select
    count(distinct au.id)
  into
    mark_count
  from public.app_users au
  left join public.teams t
    on t.id = au.team_id
  where
    lower(trim(au.display_name)) = 'mark'
    or lower(trim(t.name)) = 'mark';

  if mark_count <> 1 then
    raise exception
      'Groups foundation expected exactly one Mark account; found %.',
      mark_count;
  end if;

  select
    au.id
  into
    mark_user_id
  from public.app_users au
  left join public.teams t
    on t.id = au.team_id
  where
    lower(trim(au.display_name)) = 'mark'
    or lower(trim(t.name)) = 'mark'
  order by au.created_at asc
  limit 1;

  update public.app_users
  set
    system_role = 'super_admin',
    updated_at = now()
  where id = mark_user_id;
end
$$;


-- ============================================================
-- 9. CREATE THE EXISTING GROUP: 111
-- ============================================================

insert into public.groups (
  name,
  slug,
  created_by_user_id,
  is_active
)
select
  '111',
  '111',
  au.id,
  true
from public.app_users au
left join public.teams t
  on t.id = au.team_id
where
  lower(trim(au.display_name)) = 'mark'
  or lower(trim(t.name)) = 'mark'
order by au.created_at asc
limit 1
on conflict (lower(slug))
do update set
  name = excluded.name,
  created_by_user_id =
    coalesce(
      public.groups.created_by_user_id,
      excluded.created_by_user_id
    ),
  is_active = true,
  updated_at = now();


-- ============================================================
-- 10. CREATE THE FIVE CURRENT 111 LEAGUES
-- ============================================================

insert into public.leagues (
  group_id,
  sport_key,
  game_mode,
  name,
  slug,
  is_enabled,
  settings_version,
  settings
)
select
  g.id,
  seed.sport_key,
  seed.game_mode,
  seed.name,
  seed.slug,
  true,
  1,
  '{}'::jsonb
from public.groups g
cross join (
  values
    (
      'nba',
      'standard',
      'NBA',
      'nba'
    ),
    (
      'nfl',
      'standard',
      'NFL',
      'nfl'
    ),
    (
      'golf',
      'standard',
      'Golf',
      'golf'
    ),
    (
      'ncaa_pickem',
      'standard',
      'NCAA Pick''em',
      'ncaa-pickem'
    ),
    (
      'nba_skins',
      'standard',
      'NBA Skins',
      'nba-skins'
    )
) as seed(
  sport_key,
  game_mode,
  name,
  slug
)
where g.slug = '111'
on conflict (
  group_id,
  sport_key,
  game_mode
)
do update set
  name = excluded.name,
  slug = excluded.slug,
  is_enabled = true,
  updated_at = now();


-- ============================================================
-- 11. MIGRATE EXISTING USERS INTO GROUP 111
--
-- Current global admins become 111 Group admins.
-- Current players become members.
-- ============================================================

insert into public.group_memberships (
  group_id,
  user_id,
  role,
  is_active,
  joined_at
)
select
  g.id,
  au.id,
  case
    when au.role = 'admin'
      then 'admin'
    else 'member'
  end,
  au.is_active,
  coalesce(
    au.created_at,
    now()
  )
from public.groups g
cross join public.app_users au
where g.slug = '111'
on conflict (
  group_id,
  user_id
)
do update set
  role = excluded.role,
  is_active = excluded.is_active,
  updated_at = now();


-- ============================================================
-- 12. ATTACH EXISTING TEAMS TO GROUP 111 + THEIR USERS
-- ============================================================

update public.teams t
set
  group_id = g.id,
  user_id = au.id
from public.groups g,
     public.app_users au
where
  g.slug = '111'
  and au.team_id = t.id
  and (
    t.group_id is null
    or t.user_id is null
  );


-- ============================================================
-- 13. BACKFILL CURRENT SLATES INTO THEIR 111 LEAGUE
-- ============================================================

update public.slates s
set
  league_id = l.id
from public.leagues l
join public.groups g
  on g.id = l.group_id
where
  g.slug = '111'
  and l.game_mode = 'standard'
  and l.sport_key = s.sport
  and s.sport in (
    'nba',
    'nfl',
    'golf'
  )
  and s.league_id is null;


-- ============================================================
-- 14. BACKFILL NBA SKINS
-- ============================================================

update public.nba_skins_seasons s
set
  league_id = l.id
from public.leagues l
join public.groups g
  on g.id = l.group_id
where
  g.slug = '111'
  and l.sport_key = 'nba_skins'
  and l.game_mode = 'standard'
  and s.league_id is null;


-- ============================================================
-- 15. BACKFILL NCAA PICK'EM
-- ============================================================

update public.ncaa_pickem_weeks w
set
  league_id = l.id
from public.leagues l
join public.groups g
  on g.id = l.group_id
where
  g.slug = '111'
  and l.sport_key = 'ncaa_pickem'
  and l.game_mode = 'standard'
  and w.league_id is null;


-- ============================================================
-- 16. LEGACY-WRITE COMPATIBILITY
--
-- main is still live while feature/groups-platform is built.
--
-- Until main itself sends league_id, automatically associate new
-- legacy records with the appropriate 111 League.
-- ============================================================

create or replace function
  public.assign_legacy_111_slate_league()
returns trigger
language plpgsql
as $$
begin
  if new.league_id is null then
    select
      l.id
    into
      new.league_id
    from public.leagues l
    join public.groups g
      on g.id = l.group_id
    where
      g.slug = '111'
      and l.sport_key = new.sport
      and l.game_mode = 'standard'
      and l.is_enabled = true
    limit 1;
  end if;

  return new;
end;
$$;


drop trigger if exists
  slates_assign_legacy_111_league
on public.slates;

create trigger
  slates_assign_legacy_111_league
before insert
on public.slates
for each row
execute function
  public.assign_legacy_111_slate_league();


create or replace function
  public.assign_legacy_111_nba_skins_league()
returns trigger
language plpgsql
as $$
begin
  if new.league_id is null then
    select
      l.id
    into
      new.league_id
    from public.leagues l
    join public.groups g
      on g.id = l.group_id
    where
      g.slug = '111'
      and l.sport_key = 'nba_skins'
      and l.game_mode = 'standard'
      and l.is_enabled = true
    limit 1;
  end if;

  return new;
end;
$$;


drop trigger if exists
  nba_skins_seasons_assign_legacy_111_league
on public.nba_skins_seasons;

create trigger
  nba_skins_seasons_assign_legacy_111_league
before insert
on public.nba_skins_seasons
for each row
execute function
  public.assign_legacy_111_nba_skins_league();


create or replace function
  public.assign_legacy_111_ncaa_pickem_league()
returns trigger
language plpgsql
as $$
begin
  if new.league_id is null then
    select
      l.id
    into
      new.league_id
    from public.leagues l
    join public.groups g
      on g.id = l.group_id
    where
      g.slug = '111'
      and l.sport_key = 'ncaa_pickem'
      and l.game_mode = 'standard'
      and l.is_enabled = true
    limit 1;
  end if;

  return new;
end;
$$;


drop trigger if exists
  ncaa_pickem_weeks_assign_legacy_111_league
on public.ncaa_pickem_weeks;

create trigger
  ncaa_pickem_weeks_assign_legacy_111_league
before insert
on public.ncaa_pickem_weeks
for each row
execute function
  public.assign_legacy_111_ncaa_pickem_league();


-- ============================================================
-- 17. RLS
--
-- No client policies yet. Current server/service-role behavior is
-- unaffected. Policies arrive with the auth/authorization phase.
-- ============================================================

alter table public.groups
  enable row level security;

alter table public.group_memberships
  enable row level security;

alter table public.leagues
  enable row level security;

alter table public.group_invites
  enable row level security;


-- ============================================================
-- 18. COMMENTS
-- ============================================================

comment on table public.groups is
  'People-based Groups in 111 Sports. Example: the existing 111 group.';

comment on table public.group_memberships is
  'Membership and Group-level admin/member authorization.';

comment on table public.leagues is
  'A sport/game enabled inside a Group. Example: NFL inside Group 111.';

comment on table public.group_invites is
  'Invite-only Group membership invitations. Raw invite tokens are never stored.';

comment on column public.app_users.system_role is
  'Global application role. super_admin is independent of Group-level admin membership.';

comment on column public.teams.group_id is
  'Group that owns this fantasy-team identity.';

comment on column public.teams.user_id is
  'Account represented by this fantasy-team identity inside its Group.';

comment on column public.slates.league_id is
  'League that owns this NBA/NFL/Golf slate.';

comment on column public.nba_skins_seasons.league_id is
  'League that owns this NBA Skins season.';

comment on column public.ncaa_pickem_weeks.league_id is
  'League that owns this NCAA Pick''em week.';


-- ============================================================
-- 19. SAFETY ASSERTIONS
--
-- If any current record failed to map to 111, abort everything.
-- ============================================================

do $$
declare
  missing_team_groups integer;
  missing_user_teams integer;
  missing_slate_leagues integer;
  missing_skins_leagues integer;
  missing_ncaa_leagues integer;
  group_count integer;
  league_count integer;
begin
  select count(*)
  into group_count
  from public.groups
  where slug = '111';

  if group_count <> 1 then
    raise exception
      'Groups foundation expected exactly one 111 Group; found %.',
      group_count;
  end if;


  select count(*)
  into league_count
  from public.leagues l
  join public.groups g
    on g.id = l.group_id
  where g.slug = '111';

  if league_count <> 5 then
    raise exception
      'Groups foundation expected five 111 Leagues; found %.',
      league_count;
  end if;


  select count(*)
  into missing_team_groups
  from public.teams
  where group_id is null;

  if missing_team_groups <> 0 then
    raise exception
      'Groups foundation left % existing teams without a Group.',
      missing_team_groups;
  end if;


  select count(*)
  into missing_user_teams
  from public.app_users au
  join public.teams t
    on t.id = au.team_id
  where
    t.user_id is distinct from au.id;

  if missing_user_teams <> 0 then
    raise exception
      'Groups foundation found % app-user/team identity mismatches.',
      missing_user_teams;
  end if;


  select count(*)
  into missing_slate_leagues
  from public.slates
  where
    sport in (
      'nba',
      'nfl',
      'golf'
    )
    and league_id is null;

  if missing_slate_leagues <> 0 then
    raise exception
      'Groups foundation left % NBA/NFL/Golf slates without a League.',
      missing_slate_leagues;
  end if;


  select count(*)
  into missing_skins_leagues
  from public.nba_skins_seasons
  where league_id is null;

  if missing_skins_leagues <> 0 then
    raise exception
      'Groups foundation left % NBA Skins seasons without a League.',
      missing_skins_leagues;
  end if;


  select count(*)
  into missing_ncaa_leagues
  from public.ncaa_pickem_weeks
  where league_id is null;

  if missing_ncaa_leagues <> 0 then
    raise exception
      'Groups foundation left % NCAA Pick''em weeks without a League.',
      missing_ncaa_leagues;
  end if;
end
$$;


commit;
