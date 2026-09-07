-- Apply manually in Supabase SQL Editor. Existing NCAA favorites remain untouched.
create table if not exists public.live_score_favorite_teams (
  user_id uuid not null references public.app_users(id) on delete cascade,
  sport text not null check (sport in ('nfl')),
  espn_team_id text not null check (espn_team_id ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  primary key (user_id, sport, espn_team_id)
);
-- PIN-authenticated API handlers use the server-only service role.
alter table public.live_score_favorite_teams enable row level security;
revoke all on public.live_score_favorite_teams from anon, authenticated;
