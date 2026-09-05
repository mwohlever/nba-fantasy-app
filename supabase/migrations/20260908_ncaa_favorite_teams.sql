create table if not exists public.ncaa_favorite_teams (
  user_id uuid not null references public.app_users(id) on delete cascade,
  espn_team_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, espn_team_id)
);

create index if not exists ncaa_favorite_teams_user_id_idx
  on public.ncaa_favorite_teams(user_id);
