-- MANUAL EXECUTION ONLY, after 20260910000100_groups_batch4_scoped_uniqueness.sql.
-- A tournament-global cache cannot also represent commissioner-owned slate
-- configuration. Keep the original cache intact and copy its existing ownership.
begin;

lock table public.shotcast_manifests in share mode;

create table public.golf_slate_shotcast_manifests (
  slate_id bigint not null references public.slates(id) on delete cascade,
  tournament_id text not null,
  manifest jsonb not null,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (slate_id, tournament_id)
);

alter table public.golf_slate_shotcast_manifests enable row level security;
-- PIN sessions use server-side authorization and the service role, not direct
-- browser table access. Do not introduce public read/write policies.
revoke all on public.golf_slate_shotcast_manifests from anon, authenticated;
grant all on public.golf_slate_shotcast_manifests to service_role;

do $$
begin
  if exists (
    select 1 from public.shotcast_manifests m
    left join public.slates s on s.id = m.slate_id
    where m.slate_id is null or s.id is null or s.sport <> 'golf'
      or m.manifest is null or m.tournament_id is null
  ) then
    raise exception 'Batch 4 stopped: legacy manifest ownership/content needs inspection; original cache is unchanged';
  end if;
end
$$;

insert into public.golf_slate_shotcast_manifests
  (slate_id, tournament_id, manifest, generated_at, updated_at)
select slate_id, tournament_id, manifest::jsonb, generated_at::timestamptz, coalesce(updated_at::timestamptz, now())
from public.shotcast_manifests;

-- Retain shotcast_manifests for history and rollback; do not drop its rows/indexes.
commit;
