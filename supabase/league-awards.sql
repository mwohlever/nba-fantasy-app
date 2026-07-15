create table if not exists public.league_awards (
  id bigint generated always as identity primary key,

  season integer not null
    check (season >= 2023 and season <= 2100),

  team_id bigint not null
    references public.teams(id)
    on delete cascade,

  title text not null
    check (char_length(trim(title)) between 1 and 80),

  emoji text not null default '🏆'
    check (char_length(trim(emoji)) between 1 and 20),

  description text
    check (
      description is null
      or char_length(trim(description)) <= 300
    ),

  rarity text not null default 'common'
    check (
      rarity in (
        'common',
        'rare',
        'epic',
        'legendary'
      )
    ),

  display_order integer not null default 0,

  featured boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists league_awards_season_order_idx
  on public.league_awards (
    season desc,
    featured desc,
    display_order asc,
    id asc
  );

create index if not exists league_awards_team_season_idx
  on public.league_awards (
    team_id,
    season desc
  );

alter table public.league_awards enable row level security;
