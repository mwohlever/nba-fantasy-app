begin;

create or replace function public.delete_empty_group(
  target_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group public.groups%rowtype;
begin
  select *
  into target_group
  from public.groups
  where id = target_group_id
  for update;

  if not found then
    raise exception 'Group not found.';
  end if;

  if target_group.slug = '111' then
    raise exception 'The primary 111 Group cannot be deleted.';
  end if;

  if target_group.is_active then
    raise exception 'Deactivate the Group before permanently deleting it.';
  end if;

  if exists (
    select 1
    from public.leagues league
    join public.slates slate on slate.league_id = league.id
    where league.group_id = target_group_id
  ) or exists (
    select 1
    from public.leagues league
    join public.ncaa_pickem_weeks week on week.league_id = league.id
    where league.group_id = target_group_id
  ) or exists (
    select 1
    from public.leagues league
    join public.nba_skins_seasons season on season.league_id = league.id
    where league.group_id = target_group_id
  ) or exists (
    select 1
    from public.leagues league
    join public.league_awards award on award.league_id = league.id
    where league.group_id = target_group_id
  ) then
    raise exception
      'This Group has competitive history and cannot be permanently deleted.';
  end if;

  /*
   * Delete League-owned noncompetitive scaffolding first. Its foreign keys
   * cascade league settings/awards and null notification-history ownership.
   * Teams use a restrictive Group FK, so they must precede the Group row.
   * The function is one Postgres transaction: any failure rolls everything
   * back, including these deletes.
   */
  delete from public.leagues
  where group_id = target_group_id;

  delete from public.teams
  where group_id = target_group_id;

  delete from public.groups
  where id = target_group_id;
end;
$$;

revoke all on function public.delete_empty_group(uuid) from public;
revoke all on function public.delete_empty_group(uuid) from anon;
revoke all on function public.delete_empty_group(uuid) from authenticated;
grant execute on function public.delete_empty_group(uuid) to service_role;

commit;
