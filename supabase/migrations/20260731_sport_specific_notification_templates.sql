begin;

alter table public.notification_templates
  add column if not exists sport text;

update public.notification_templates
set sport = 'nba'
where sport is null
   or sport not in ('nba', 'nfl', 'golf');

alter table public.notification_templates
  alter column sport set default 'nba';

alter table public.notification_templates
  alter column sport set not null;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select con.conname
    from pg_constraint con
    join pg_class rel
      on rel.oid = con.conrelid
    join pg_namespace nsp
      on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'notification_templates'
      and con.contype = 'u'
      and (
        select array_agg(
          att.attname::text
          order by keys.ordinality
        )
        from unnest(con.conkey) with ordinality
          as keys(attnum, ordinality)
        join pg_attribute att
          on att.attrelid = rel.oid
         and att.attnum = keys.attnum
      ) = array['notification_type']::text[]
  loop
    execute format(
      'alter table public.notification_templates drop constraint %I',
      constraint_row.conname
    );
  end loop;
end
$$;

alter table public.notification_templates
  drop constraint if exists notification_templates_pkey;

alter table public.notification_templates
  add constraint notification_templates_pkey
  primary key (notification_type, sport);

alter table public.notification_templates
  drop constraint if exists notification_templates_sport_check;

alter table public.notification_templates
  add constraint notification_templates_sport_check
  check (sport in ('nba', 'nfl', 'golf'));

create unique index if not exists
  notification_templates_type_sport_unique
on public.notification_templates (
  notification_type,
  sport
);

commit;
