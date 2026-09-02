begin;

create table if not exists public.user_avatar_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  storage_path text not null,
  content_sha256 text not null,
  mime_type text not null,
  created_at timestamptz not null default now(),
  constraint user_avatar_images_storage_path_key unique (storage_path),
  constraint user_avatar_images_user_hash_key unique (user_id, content_sha256),
  constraint user_avatar_images_sha256_check check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint user_avatar_images_mime_type_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp'))
);

create index if not exists user_avatar_images_user_created_idx
on public.user_avatar_images (user_id, created_at desc);

alter table public.user_avatar_images enable row level security;

comment on table public.user_avatar_images is
  'The five most recently uploaded account-level custom avatars for each 111 Sports user. Access is mediated by authenticated server routes.';
comment on column public.user_avatar_images.storage_path is
  'Object path inside the public profile-images Supabase Storage bucket.';

commit;
