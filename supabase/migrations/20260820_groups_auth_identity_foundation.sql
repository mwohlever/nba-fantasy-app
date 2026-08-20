begin;


-- ============================================================
-- 1. MODERN AUTH IDENTITY FIELDS
--
-- app_users remains the permanent 111 Sports account record.
--
-- auth_user_id points to Supabase Auth.
-- email is the canonical account/invite email.
--
-- Both remain nullable until an existing account is explicitly
-- linked or a new invited account is created.
-- ============================================================

alter table public.app_users
  add column if not exists auth_user_id uuid;

alter table public.app_users
  add column if not exists email text;

alter table public.app_users
  add column if not exists auth_linked_at timestamptz;


-- ============================================================
-- 2. AUTH USER FOREIGN KEY
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_auth_user_id_fkey'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_auth_user_id_fkey
      foreign key (auth_user_id)
      references auth.users(id)
      on delete set null;
  end if;
end
$$;


create unique index if not exists
  app_users_auth_user_id_unique
on public.app_users (
  auth_user_id
)
where auth_user_id is not null;


create unique index if not exists
  app_users_email_unique
on public.app_users (
  lower(trim(email))
)
where email is not null;


create index if not exists
  app_users_email_lookup_idx
on public.app_users (
  lower(trim(email))
);


-- ============================================================
-- 3. EMAIL VALIDATION
--
-- Deliberately lightweight.
-- Full validation happens through Supabase Auth / invite flow.
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_email_check'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_email_check
      check (
        email is null
        or (
          char_length(trim(email))
            between 3 and 320
          and position('@' in email) > 1
        )
      );
  end if;
end
$$;


-- ============================================================
-- 4. TEAM_ID BECOMES LEGACY / OPTIONAL
--
-- A future account may exist before onboarding finishes.
-- A single user may also own one team PER GROUP.
--
-- teams.user_id + teams.group_id is authoritative.
--
-- Keep app_users.team_id for existing runtime compatibility,
-- but it can no longer be mandatory.
-- ============================================================

alter table public.app_users
  alter column team_id drop not null;


/*
 * Replace ON DELETE CASCADE.
 *
 * Deleting one Group-specific team must never delete the
 * underlying account.
 */
alter table public.app_users
  drop constraint if exists app_users_team_id_fkey;

alter table public.app_users
  add constraint app_users_team_id_fkey
  foreign key (team_id)
  references public.teams(id)
  on delete set null;


-- ============================================================
-- 5. PIN BECOMES OPTIONAL
--
-- Existing users retain their current hashes.
--
-- New Google/email-password users do not need a PIN at all.
-- PIN remains available during Groups beta.
-- ============================================================

alter table public.app_users
  alter column pin_salt drop not null;

alter table public.app_users
  alter column pin_hash drop not null;


-- Either both PIN values exist, or neither does.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_pin_pair_check'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_pin_pair_check
      check (
        (
          pin_salt is null
          and pin_hash is null
        )
        or
        (
          pin_salt is not null
          and pin_hash is not null
        )
      );
  end if;
end
$$;


-- ============================================================
-- 6. NORMALIZE INVITE EMAIL STORAGE
-- ============================================================

update public.group_invites
set email =
  lower(trim(email))
where email is distinct from lower(trim(email));


-- Future inserts/updates should use normalized addresses.
create or replace function
  public.normalize_111_account_email()
returns trigger
language plpgsql
as $$
begin
  if new.email is not null then
    new.email =
      lower(trim(new.email));
  end if;

  return new;
end;
$$;


drop trigger if exists
  app_users_normalize_email
on public.app_users;

create trigger
  app_users_normalize_email
before insert or update of email
on public.app_users
for each row
execute function
  public.normalize_111_account_email();


drop trigger if exists
  group_invites_normalize_email
on public.group_invites;

create trigger
  group_invites_normalize_email
before insert or update of email
on public.group_invites
for each row
execute function
  public.normalize_111_account_email();


-- ============================================================
-- 7. COMMENTS / CONTRACT
-- ============================================================

comment on column public.app_users.auth_user_id is
  'Linked Supabase Auth identity. Nullable until an account is linked or onboarding completes.';

comment on column public.app_users.email is
  'Canonical normalized account email used for authentication linking and Group invitations.';

comment on column public.app_users.auth_linked_at is
  'Timestamp when this 111 Sports account was linked to Supabase Auth.';

comment on column public.app_users.team_id is
  'Legacy/default team pointer retained for runtime compatibility. Group-specific identity is authoritative through teams.user_id + teams.group_id.';

comment on column public.app_users.pin_salt is
  'Legacy optional PIN credential retained during Groups beta. New Supabase Auth users may have no PIN.';

comment on column public.app_users.pin_hash is
  'Legacy optional PIN credential retained during Groups beta. New Supabase Auth users may have no PIN.';


-- ============================================================
-- 8. SAFETY ASSERTIONS
--
-- Existing four accounts must still retain their legacy team
-- and PIN relationships after this additive migration.
-- ============================================================

do $$
declare
  broken_existing_accounts integer;
  duplicate_auth_links integer;
  duplicate_emails integer;
begin

  select
    count(*)
  into
    broken_existing_accounts
  from public.app_users au
  where
    au.created_at <
      now()
    and (
      au.team_id is null
      or au.pin_salt is null
      or au.pin_hash is null
    );


  if broken_existing_accounts <> 0 then
    raise exception
      'Auth foundation unexpectedly found % existing accounts missing legacy team/PIN data.',
      broken_existing_accounts;
  end if;


  select
    count(*)
  into
    duplicate_auth_links
  from (
    select auth_user_id
    from public.app_users
    where auth_user_id is not null
    group by auth_user_id
    having count(*) > 1
  ) duplicates;


  if duplicate_auth_links <> 0 then
    raise exception
      'Auth foundation found % duplicate Supabase Auth links.',
      duplicate_auth_links;
  end if;


  select
    count(*)
  into
    duplicate_emails
  from (
    select lower(trim(email))
    from public.app_users
    where email is not null
    group by lower(trim(email))
    having count(*) > 1
  ) duplicates;


  if duplicate_emails <> 0 then
    raise exception
      'Auth foundation found % duplicate account emails.',
      duplicate_emails;
  end if;

end
$$;


commit;
