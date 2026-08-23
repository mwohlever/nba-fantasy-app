-- ============================================================
-- 111 SPORTS — LEAGUE NOTIFICATIONS FOUNDATION
-- Part 6
--
-- Global notification_templates remain platform/default wording.
-- league_notification_settings stores league-level overrides.
-- notification_history gains authoritative league ownership.
-- ============================================================

begin;


-- ============================================================
-- 1. LEAGUE-LEVEL NOTIFICATION CONFIGURATION
-- ============================================================

create table if not exists public.league_notification_settings (
  league_id uuid not null
    references public.leagues(id)
    on delete cascade,

  notification_type text not null,

  is_enabled boolean not null default true,

  title_template text,
  body_template text,

  reminder_hours integer,

  updated_by uuid
    references public.app_users(id)
    on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (
    league_id,
    notification_type
  ),

  constraint league_notification_settings_title_length_check
    check (
      title_template is null
      or char_length(title_template) <= 100
    ),

  constraint league_notification_settings_body_length_check
    check (
      body_template is null
      or char_length(body_template) <= 240
    ),

  constraint league_notification_settings_reminder_hours_check
    check (
      reminder_hours is null
      or reminder_hours between 1 and 168
    )
);

create index if not exists
  league_notification_settings_league_idx
on public.league_notification_settings (
  league_id
);

alter table public.league_notification_settings
  enable row level security;

comment on table public.league_notification_settings is
  'Per-league notification enablement and optional wording/timing overrides. Platform notification templates remain the fallback defaults.';


-- ============================================================
-- 2. NOTIFICATION HISTORY LEAGUE OWNERSHIP
-- ============================================================

alter table public.notification_history
  add column if not exists league_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_history_league_id_fkey'
      and conrelid = 'public.notification_history'::regclass
  ) then
    alter table public.notification_history
      add constraint notification_history_league_id_fkey
      foreign key (league_id)
      references public.leagues(id)
      on delete set null;
  end if;
end
$$;

create index if not exists
  notification_history_league_created_idx
on public.notification_history (
  league_id,
  created_at desc
);


-- ============================================================
-- 3. BACKFILL EXISTING SLATE-BASED HISTORY
-- ============================================================

update public.notification_history as history
set league_id = slate.league_id
from public.slates as slate
where history.league_id is null
  and history.slate_id = slate.id
  and slate.league_id is not null;


comment on column public.notification_history.league_id is
  'League that owns this notification event. Slate/week generated notifications should always populate this when league ownership is known.';


commit;
