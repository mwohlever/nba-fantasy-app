-- Fabricated records only. Minimal parent relations; actual observation/draft
-- migrations are installed by the harness. This is NOT a production restoration.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.groups(id uuid primary key);
create table public.leagues(id uuid primary key,group_id uuid references groups(id),sport_key text,is_enabled boolean default true);
create table public.app_users(id uuid primary key,display_name text,is_active boolean default true,system_role text,role text);
create table public.group_memberships(group_id uuid,user_id uuid,is_active boolean,role text);
create table public.teams(id bigint primary key,group_id uuid references groups(id),user_id uuid,name text);
create table public.players(id bigint primary key,nba_player_id bigint unique,name text,position_group text,team_abbreviation text,is_active boolean);
create table public.players_nfl(id bigint primary key,nfl_player_id bigint unique,name text,position text,team_abbreviation text,is_active boolean);
create table public.slates(id bigint primary key,league_id uuid references leagues(id),sport text,is_locked boolean default false,
  rules_snapshot jsonb,rules_version integer,date date,start_date date,end_date date,first_game_start_time timestamptz,nba_team_abbreviations text[]);
create table public.slate_teams(slate_id bigint,team_id bigint,draft_order integer,is_participating boolean);
create table public.lineups(id bigint generated always as identity primary key,slate_id bigint,team_id bigint,unique(slate_id,team_id));
create table public.lineup_players(id bigint generated always as identity primary key,lineup_id bigint references lineups(id),player_id bigint,
  roster_slot_position text,roster_slot_index integer,projected_fantasy_points numeric,projection_confidence text,projection_source text,projected_at timestamptz);
-- Preservation sentinel for existing score/snapshot values (not a production schema claim).
create table public.fixture_saved_scores(slate_id bigint,player_id bigint,fantasy_points numeric,rules_snapshot jsonb);
insert into groups values('00000000-0000-0000-0000-000000000001');
insert into leagues values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','nba',true),
  ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','nfl',true);
insert into app_users values('00000000-0000-0000-0000-000000000004','Fixture',true,'super_admin','admin');
insert into teams values(1,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','Saved fantasy team');
insert into players select id,1000+id,'Fixture NBA '||id,'G','OLD',id<>5 from generate_series(1,6) id;
insert into players_nfl values(101,4373626,'Allgeier fixture','RB','ATL',true),(102,9002,'QB fixture','QB','OLD',true),
  (103,9003,'K fixture','K','OLD',true),(104,100000001,'Team defense fixture','D/ST','OLD',true);
insert into slates select id,'00000000-0000-0000-0000-000000000002','nba',id=90,
  '{"schemaVersion":1,"sport":"nba","roster":{"slots":[{"position":"G","slotCount":2},{"position":"F/C","slotCount":3}]},"scoring":{"points":1,"rebounds":1.2,"assists":1.5,"steals":2,"blocks":2,"turnovers":-1}}',1,
  '2026-10-06','2026-10-06','2026-10-07','2026-10-06T19:00:00Z',array['A','B'] from generate_series(1,100) id;
insert into slates values(200,'00000000-0000-0000-0000-000000000003','nfl',false,
  '{"schemaVersion":1,"sport":"nfl","roster":{"slots":[{"position":"QB","slotCount":1},{"position":"RB","slotCount":2},{"position":"K","slotCount":0},{"position":"D/ST","slotCount":0}]}}',1,'2026-10-06','2026-10-06','2026-10-07','2026-10-06T19:00:00Z',null);
