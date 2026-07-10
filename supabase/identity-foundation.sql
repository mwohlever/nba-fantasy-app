create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  team_id bigint not null unique references public.teams(id) on delete cascade,
  display_name text not null,
  role text not null default 'player'
    check (role in ('player', 'admin')),
  pin_salt text not null,
  pin_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists user_sessions_user_id_idx
  on public.user_sessions(user_id);

create index if not exists user_sessions_expires_at_idx
  on public.user_sessions(expires_at);

alter table public.app_users enable row level security;
alter table public.user_sessions enable row level security;

comment on table public.app_users is
  'Lightweight league identities associated with fantasy teams.';

comment on table public.user_sessions is
  'Hashed login sessions. Raw session tokens are only stored in secure cookies.';
