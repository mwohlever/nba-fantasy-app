-- Read-only, for manual Supabase SQL Editor verification after an approved installation.
begin transaction read only;
set local statement_timeout='20s';
select p.oid::regprocedure::text as function,pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,p.proconfig,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p where p.oid in ('public.publish_player_center_nba_refresh(uuid,integer,timestamptz,jsonb)'::regprocedure,
  'public.player_center_nba_refresh_health(boolean)'::regprocedure);
select c.relname,c.relrowsecurity,
  has_table_privilege('service_role',c.oid,'SELECT') as service_select,
  has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE') as service_dml,
  has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
  has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_access
from pg_class c where c.oid in ('public.player_center_season_cache'::regclass,'public.player_center_nba_refresh_status'::regclass);
select public.player_center_nba_refresh_health(true);
select season,outcome,count(*) as players,max(last_attempt_at) as last_attempt,
  max(last_verified_at) as last_verified,max(last_failure_at) as last_failure
from public.player_center_nba_refresh_status group by season,outcome order by season,outcome;
commit;
