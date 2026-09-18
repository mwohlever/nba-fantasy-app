begin;

alter table public.user_avatar_images
  add column if not exists optimized_storage_path text,
  add column if not exists optimized_content_sha256 text;

create unique index if not exists user_avatar_images_optimized_storage_path_key
  on public.user_avatar_images (optimized_storage_path)
  where optimized_storage_path is not null;

alter table public.user_avatar_images
  drop constraint if exists user_avatar_images_optimized_sha256_check;

alter table public.user_avatar_images
  add constraint user_avatar_images_optimized_sha256_check
  check (
    optimized_content_sha256 is null
    or optimized_content_sha256 ~ '^[0-9a-f]{64}$'
  );

comment on column public.user_avatar_images.optimized_storage_path is
  'Optional 256px WebP display derivative in the public profile-images Storage bucket. The original storage_path remains preserved.';

commit;
