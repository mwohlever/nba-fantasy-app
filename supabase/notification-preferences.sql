create table if not exists public.notification_preferences (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  notifications_enabled boolean not null default true,
  draft_turn_enabled boolean not null default true,
  player_finished_enabled boolean not null default true,
  slate_final_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

comment on table public.notification_preferences is
  'Per-user preferences for fantasy league push notifications.';
