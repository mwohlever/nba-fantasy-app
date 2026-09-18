begin;

alter table public.players
  add column if not exists headshot_url text;

alter table public.players_nfl
  add column if not exists headshot_url text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'sports-headshots',
  'sports-headshots',
  true,
  262144,
  array['image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on column public.players.headshot_url is
  'Optional app-owned optimized NBA display headshot. The NBA provider image remains derivable from nba_player_id as fallback.';

comment on column public.players_nfl.headshot_url is
  'Optional app-owned optimized NFL display headshot. The ESPN provider image remains derivable from nfl_player_id as fallback.';

commit;
