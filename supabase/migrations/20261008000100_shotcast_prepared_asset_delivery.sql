-- Phase 4D.4 only. Review and run manually; creates no registry/asset records.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shotcast-prepared-private', 'shotcast-prepared-private', false, 52428800,
  array['model/gltf-binary','image/jpeg','image/png','text/plain','application/json']);

-- Restrictive policies prevent existing broad browser policies granting access to
-- this bucket. Other buckets retain their existing policy behavior. Service-role
-- server calls bypass RLS; credentials must remain on the server.
create policy shotcast_prepared_no_browser_objects on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'shotcast-prepared-private')
  with check (bucket_id <> 'shotcast-prepared-private');
create policy shotcast_prepared_no_browser_bucket on storage.buckets
  as restrictive for all to anon, authenticated
  using (id <> 'shotcast-prepared-private')
  with check (id <> 'shotcast-prepared-private');

-- Separate delivery approval: accepted research registration/currentness alone
-- must never authorize distribution. A bounded index avoids binary DB storage.
create table public.shotcast_asset_delivery_manifests (
  preparation_id text primary key references public.shotcast_prepared_revisions(preparation_id) on delete restrict,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null check (
    jsonb_typeof(manifest) = 'object' and octet_length(manifest::text) <= 16384 and
    (manifest->>'schemaVersion') is not distinct from '1' and
    (manifest->>'packageSchemaVersion') is not distinct from '2' and
    (manifest->>'preparationId') is not distinct from preparation_id and
    (manifest->>'preparationVersion') is not distinct from '1' and
    (manifest->>'hole') is not null and (manifest->>'hole')::integer between 1 and 18 and
    jsonb_typeof(manifest->'assets') is not distinct from 'array' and
    jsonb_array_length(manifest->'assets') between 7 and 8),
  state text not null default 'pending' check (state in ('pending','approved','rejected','stale')),
  integrity_verified_at timestamptz not null,
  approved_at timestamptz,
  check (state <> 'approved' or (approved_at is not null and approved_at >= integrity_verified_at))
);

create function public.guard_shotcast_delivery_manifest() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ShotCast delivery manifests are immutable'; end if;
  if tg_op = 'UPDATE' and (
    (to_jsonb(new) - array['state','approved_at']) is distinct from (to_jsonb(old) - array['state','approved_at']) or
    (old.approved_at is not null and new.approved_at is distinct from old.approved_at))
  then raise exception 'ShotCast delivery content and approval evidence are immutable'; end if;
  if new.state = 'approved' and not exists (
    select 1 from public.shotcast_prepared_revisions r where r.preparation_id = new.preparation_id
      and r.state = 'validated' and r.is_current
      and (new.manifest->>'hole')::integer = (r.validation_proof->>'hole')::integer
      and new.manifest->>'preparationVersion' = r.preparation_version)
  then raise exception 'ShotCast delivery requires current validated bounded revision'; end if;
  return new;
end;
$$;
create trigger shotcast_delivery_manifest_guard before insert or update or delete on public.shotcast_asset_delivery_manifests
  for each row execute function public.guard_shotcast_delivery_manifest();
alter table public.shotcast_asset_delivery_manifests enable row level security;
revoke all on public.shotcast_asset_delivery_manifests from public, anon, authenticated;
grant select, insert, update on public.shotcast_asset_delivery_manifests to service_role;
revoke all on function public.guard_shotcast_delivery_manifest() from public, anon, authenticated;

commit;
