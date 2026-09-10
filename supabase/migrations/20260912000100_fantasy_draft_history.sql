-- MANUAL REVIEW/APPLICATION ONLY. Pause NBA/NFL roster mutations, apply this file,
-- apply verified history backfills, deploy matching app, then resume drafting.
-- No existing roster/history is rewritten. Legacy populated drafts need reviewed
-- chronology before further picks; commissioner corrections remain available.
begin;

create table public.fantasy_drafts (
  slate_id bigint primary key references public.slates(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  league_id uuid not null references public.leagues(id) on delete restrict,
  sport text not null check (sport in ('nba','nfl')),
  participant_ids bigint[] not null check (cardinality(participant_ids) > 0),
  roster_slots jsonb not null check (jsonb_typeof(roster_slots) = 'array'),
  rules_snapshot jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique (slate_id, group_id, league_id, sport)
);
-- This freezes draft configuration, not a second cursor. max(overall_pick) over
-- ALL picks (including reversed picks), under the slate lock, is the only cursor.
create table public.draft_picks (
  id bigint generated always as identity primary key,
  slate_id bigint not null,
  group_id uuid not null,
  league_id uuid not null,
  sport text not null,
  overall_pick integer not null check (overall_pick > 0),
  round_number integer not null check (round_number > 0),
  pick_in_round integer not null check (pick_in_round > 0),
  team_id bigint not null references public.teams(id) on delete restrict,
  player_id bigint not null,
  -- Polymorphic player IDs are validated against the sport table by the RPC
  -- and existing lineup trigger. Snapshot labels survive directory changes.
  player_name text not null,
  player_position text not null,
  team_name text not null,
  roster_slot_position text not null,
  roster_slot_index integer not null check (roster_slot_index >= 0),
  created_at timestamptz not null default clock_timestamp(),
  occurred_at timestamptz,
  actor_user_id uuid references public.app_users(id) on delete restrict,
  actor_name text,
  is_proxy boolean,
  source text not null check (source in ('live','verified_backfill')),
  status text not null default 'active' check (status in ('active','reversed')),
  reversed_at timestamptz,
  reversed_by uuid references public.app_users(id) on delete restrict,
  foreign key (slate_id, group_id, league_id, sport)
    references public.fantasy_drafts(slate_id, group_id, league_id, sport) on delete restrict,
  unique (slate_id, overall_pick),
  check ((status = 'active' and reversed_at is null and reversed_by is null)
    or (status = 'reversed' and reversed_at is not null and reversed_by is not null)),
  check (source <> 'live' or (occurred_at is not null and actor_user_id is not null and is_proxy is not null))
);
create unique index draft_picks_active_player on public.draft_picks(slate_id, player_id) where status = 'active';
create index draft_picks_group_slate on public.draft_picks(group_id, league_id, sport, slate_id);

create table public.draft_corrections (
  id bigint generated always as identity primary key,
  slate_id bigint not null references public.slates(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete restrict,
  league_id uuid not null references public.leagues(id) on delete restrict,
  sport text not null check (sport in ('nba','nfl')),
  pick_id bigint references public.draft_picks(id) on delete restrict,
  team_id bigint not null references public.teams(id) on delete restrict,
  old_player_id bigint,
  new_player_id bigint,
  old_player_name text,
  new_player_name text,
  actor_name text not null,
  actor_user_id uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check (old_player_id is not null or new_player_id is not null)
);
create index draft_corrections_scope on public.draft_corrections(group_id, league_id, sport, slate_id, id);

-- PIN sessions are authorized by API handlers using the server service role.
-- There are deliberately no anonymous/authenticated policies or write grants.
alter table public.fantasy_drafts enable row level security;
alter table public.draft_picks enable row level security;
alter table public.draft_corrections enable row level security;
revoke all on public.fantasy_drafts, public.draft_picks, public.draft_corrections from public, anon, authenticated, service_role;
grant select on public.fantasy_drafts, public.draft_picks, public.draft_corrections to service_role;

create function public.fantasy_slot_eligible(p_sport text, p_player text, p_slot text)
returns boolean language sql immutable set search_path = public as $$
  select case when p_sport = 'nba' then
    case when upper(trim(p_player)) in ('PG','SG','G') then p_slot in ('G','UTIL')
         when upper(trim(p_player)) in ('SF','PF','C','F','F/C','FC') then p_slot in ('F/C','UTIL') else false end
  when p_sport = 'nfl' then upper(trim(p_player)) = p_slot
    or (p_slot = 'FLEX' and upper(trim(p_player)) in ('RB','WR','TE'))
    or (p_slot in ('SF','SUPERFLEX') and upper(trim(p_player)) in ('QB','RB','WR','TE'))
  else false end;
$$;

-- A statement-consistent read: history, configuration, and roster counts cannot
-- come from different transactions. API performs active Group access checks first.
create function public.read_fantasy_draft(p_slate_id bigint, p_group_id uuid, p_league_id uuid, p_sport text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'initialized', d.slate_id is not null,
    'is_locked', s.is_locked,
    'roster_slots', d.roster_slots,
    'rules_snapshot', s.rules_snapshot,
    'participant_ids', coalesce(to_jsonb(d.participant_ids),
      (select coalesce(jsonb_agg(st.team_id order by st.draft_order),'[]'::jsonb) from slate_teams st
       join teams t on t.id = st.team_id and t.group_id = p_group_id
       where st.slate_id = s.id and st.is_participating)),
    'roster_counts', coalesce((select jsonb_object_agg(x.team_id,x.n) from
      (select l.team_id,count(lp.id) as n from lineups l left join lineup_players lp on lp.lineup_id=l.id
       where l.slate_id=s.id group by l.team_id) x),'{}'::jsonb),
    'picks', (select coalesce(jsonb_agg(to_jsonb(p) order by p.overall_pick),'[]'::jsonb) from draft_picks p
      where p.slate_id=s.id and p.group_id=p_group_id and p.league_id=p_league_id and p.sport=p_sport),
    'corrections', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from draft_corrections c
      where c.slate_id=s.id and c.group_id=p_group_id and c.league_id=p_league_id and c.sport=p_sport))
  from slates s join leagues l on l.id=s.league_id
  left join fantasy_drafts d on d.slate_id=s.id
  where s.id=p_slate_id and s.league_id=p_league_id and l.group_id=p_group_id
    and s.sport=p_sport and l.sport_key=p_sport and p_sport in ('nba','nfl');
$$;

create function public.mutate_fantasy_draft(
  p_slate_id bigint, p_group_id uuid, p_league_id uuid, p_sport text,
  p_team_id bigint, p_actor_id uuid, p_intent jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s slates%rowtype; d fantasy_drafts%rowtype; actor app_users%rowtype; receiver teams%rowtype;
  ids bigint[]; old_ids bigint[]; expected_ids bigint[]; added bigint[]; removed bigint[]; participants bigint[];
  lineup_id_value bigint; next_pick integer; round_index integer; offset_value integer; expected_team bigint;
  slot_count_value integer; correction boolean := coalesce((p_intent->>'correction')::boolean,false);
  commissioner boolean; proxy_allowed boolean; r record; player_position_value text; player_name_value text;
  pick_id_value bigint; slots jsonb := p_intent->'roster_slots'; assignments jsonb := p_intent->'assignments';
begin
  -- All roster writes for this slate serialize here, including corrections.
  select * into s from slates where id=p_slate_id for update;
  if not found or p_sport not in ('nba','nfl') or s.sport<>p_sport or s.league_id<>p_league_id
    or not exists(select 1 from leagues where id=p_league_id and group_id=p_group_id and sport_key=p_sport and is_enabled)
    then raise exception 'Draft is outside the authorized Group/league/sport'; end if;
  select * into actor from app_users where id=p_actor_id and is_active;
  if not found then raise exception 'Active actor required'; end if;
  commissioner := coalesce(actor.system_role='super_admin',false) or exists(select 1 from group_memberships where group_id=p_group_id and user_id=p_actor_id and is_active and role='admin');
  proxy_allowed := commissioner or coalesce(actor.role='admin',false);
  if actor.system_role is distinct from 'super_admin' and not exists(select 1 from group_memberships where group_id=p_group_id and user_id=p_actor_id and is_active)
    then raise exception 'Active Group membership required'; end if;
  select * into receiver from teams where id=p_team_id and group_id=p_group_id;
  if not found or (receiver.user_id is distinct from p_actor_id and not proxy_allowed)
    then raise exception 'Commissioner access required to draft for another participant'; end if;
  if correction and not commissioner then raise exception 'Commissioner access required for corrections'; end if;
  if not correction and s.is_locked then raise exception 'This slate is locked'; end if;
  if not correction and coalesce(s.rules_snapshot#>>'{draft,type}','snake')<>'snake' then raise exception 'This draft format requires commissioner review'; end if;
  if not correction and (not exists(select 1 from slate_teams where slate_id=p_slate_id and team_id=p_team_id and is_participating)
    or not exists(select 1 from group_memberships where group_id=p_group_id and user_id=receiver.user_id and is_active))
    then raise exception 'Receiving participant is not active in this draft'; end if;
  -- Rules are resolved only by the canonical TS resolver on the trusted server.
  -- Recheck the exact input snapshot under lock; never accept client rules.
  if s.rules_snapshot is distinct from nullif(p_intent->'rules_snapshot','null'::jsonb)
    then raise exception 'Rules changed; refresh Draft'; end if;
  if jsonb_typeof(slots) is distinct from 'array' or jsonb_typeof(assignments) is distinct from 'array'
    then raise exception 'Resolved roster configuration required'; end if;
  select sum(x.slot_count) into slot_count_value from jsonb_to_recordset(slots) x(position text,slot_count integer);
  if slot_count_value is null or slot_count_value<1 then raise exception 'Invalid roster configuration'; end if;
  select coalesce(array_agg(v::bigint order by v::bigint),'{}'::bigint[]) into ids from jsonb_array_elements_text(p_intent->'desired_ids') v;
  select coalesce(array_agg(v::bigint order by v::bigint),'{}'::bigint[]) into expected_ids from jsonb_array_elements_text(p_intent->'expected_ids') v;
  if cardinality(ids)<>(select count(distinct v) from unnest(ids) v) or cardinality(ids)>slot_count_value
    then raise exception 'Duplicate players or roster overflow'; end if;
  if (select count(*) from lineups where slate_id=p_slate_id and team_id=p_team_id)>1 then raise exception 'Duplicate legacy lineups require review'; end if;
  select id into lineup_id_value from lineups where slate_id=p_slate_id and team_id=p_team_id;
  select coalesce(array_agg(player_id order by player_id),'{}'::bigint[]) into old_ids from lineup_players where lineup_id=lineup_id_value;
  if old_ids is distinct from expected_ids then raise exception 'Roster changed; refresh Draft and try again'; end if;
  select coalesce(array_agg(v),'{}'::bigint[]) into added from unnest(ids) v where not(v=any(old_ids));
  select coalesce(array_agg(v),'{}'::bigint[]) into removed from unnest(old_ids) v where not(v=any(ids));
  if cardinality(removed)>0 and not commissioner then raise exception 'Commissioner access required to remove or correct a draft pick'; end if;
  if cardinality(added)=0 and cardinality(removed)=0 then return jsonb_build_object('lineupId',lineup_id_value,'addedPlayerIds',added,'removedPlayerIds',removed,'isPick',false); end if;
  if correction then
    if cardinality(added)>1 or cardinality(removed)>1 then raise exception 'Correct one assignment at a time'; end if;
  elsif not ((cardinality(added)=1 and cardinality(removed)=0) or (cardinality(added)=0 and cardinality(removed)=1)) then
    raise exception 'Draft one player at a time; use commissioner corrections for replacements';
  end if;
  if exists(select 1 from lineup_players lp join lineups l on l.id=lp.lineup_id
    where l.slate_id=p_slate_id and l.team_id<>p_team_id and lp.player_id=any(ids))
    then raise exception 'Player is already rostered in this slate'; end if;
  if jsonb_array_length(assignments)<>cardinality(ids)
    or (select count(distinct x.player_id) from jsonb_to_recordset(assignments) x(player_id bigint))<>cardinality(ids)
    or (select count(distinct (x.position,x.slot_index)) from jsonb_to_recordset(assignments) x(position text,slot_index integer))<>cardinality(ids)
    then raise exception 'Complete unique roster assignments required'; end if;
  for r in select * from jsonb_to_recordset(assignments) x(player_id bigint,position text,slot_index integer) loop
    if not(r.player_id=any(ids)) or not exists(select 1 from jsonb_to_recordset(slots) x(position text,slot_count integer)
      where x.position=r.position and r.slot_index>=0 and r.slot_index<x.slot_count) then raise exception 'Illegal roster slot'; end if;
    if p_sport='nfl' then select position,name into player_position_value,player_name_value from players_nfl where id=r.player_id and (is_active or correction);
    else select position_group,name into player_position_value,player_name_value from players where id=r.player_id and (is_active or correction); end if;
    if not found or not fantasy_slot_eligible(p_sport,player_position_value,r.position) then raise exception 'Player is unavailable or ineligible for slot'; end if;
    -- Existing explicit slot choices may not be silently moved by a stale client.
    if exists(select 1 from lineup_players lp where lp.lineup_id=lineup_id_value and lp.player_id=r.player_id
      and lp.roster_slot_position is not null and lp.roster_slot_index is not null
      and (lp.roster_slot_position<>r.position or lp.roster_slot_index<>r.slot_index)) then raise exception 'Saved roster slot changed'; end if;
  end loop;
  select * into d from fantasy_drafts where slate_id=p_slate_id;
  if d.slate_id is not null and (d.roster_slots<>slots or d.rules_snapshot is distinct from s.rules_snapshot)
    then raise exception 'Frozen draft configuration does not match'; end if;
  if not correction and cardinality(added)=1 then
    if d.slate_id is null then
      if exists(select 1 from lineup_players lp join lineups l on l.id=lp.lineup_id where l.slate_id=p_slate_id)
        or exists(select 1 from draft_corrections where slate_id=p_slate_id) then raise exception 'Existing draft needs verified history before further picks'; end if;
      select array_agg(st.team_id order by st.draft_order) into participants from slate_teams st where st.slate_id=p_slate_id and st.is_participating;
      if coalesce(cardinality(participants),0)=0 or exists(
        select 1 from (select draft_order,row_number() over(order by draft_order) n from slate_teams where slate_id=p_slate_id and is_participating) x where draft_order is distinct from n)
        or exists(select 1 from unnest(participants) v where not exists(select 1 from teams t join group_memberships gm on gm.user_id=t.user_id and gm.group_id=t.group_id and gm.is_active where t.id=v and t.group_id=p_group_id))
        then raise exception 'Draft participant order requires review'; end if;
      insert into fantasy_drafts(slate_id,group_id,league_id,sport,participant_ids,roster_slots,rules_snapshot)
        values(p_slate_id,p_group_id,p_league_id,p_sport,participants,slots,s.rules_snapshot) returning * into d;
    end if;
    select coalesce(max(overall_pick),0)+1 into next_pick from draft_picks where slate_id=p_slate_id;
    if exists(select 1 from unnest(d.participant_ids) v where
      (select count(*) from lineup_players lp join lineups l on l.id=lp.lineup_id where l.slate_id=p_slate_id and l.team_id=v)
      <> (select count(*) from draft_picks where slate_id=p_slate_id and team_id=v))
      then raise exception 'Roster correction required before drafting can continue'; end if;
    if next_pick>cardinality(d.participant_ids)*slot_count_value then raise exception 'Draft chronology is complete; use corrections for roster vacancies'; end if;
    round_index := (next_pick-1)/cardinality(d.participant_ids);
    offset_value := (next_pick-1)%cardinality(d.participant_ids);
    expected_team := d.participant_ids[case when round_index%2=0 then offset_value+1 else cardinality(d.participant_ids)-offset_value end];
    if expected_team<>p_team_id then raise exception 'It is another participant''s turn; refresh Draft'; end if;
    if cardinality(old_ids)<>round_index then raise exception 'Roster correction required before drafting can continue'; end if;
  end if;
  perform set_config('app.fantasy_draft_mutation','on',true);
  if lineup_id_value is null then insert into lineups(slate_id,team_id) values(p_slate_id,p_team_id) returning id into lineup_id_value; end if;
  if cardinality(removed)=1 then
    select id into pick_id_value from draft_picks where slate_id=p_slate_id and team_id=p_team_id and player_id=removed[1] and status='active';
    -- A subsequent correction to a replacement retains the original pick link.
    if pick_id_value is null then select pick_id into pick_id_value from draft_corrections where slate_id=p_slate_id and team_id=p_team_id and new_player_id=removed[1] order by id desc limit 1; end if;
    update draft_picks set status='reversed',reversed_at=clock_timestamp(),reversed_by=p_actor_id where id=pick_id_value and status='active';
    delete from lineup_players where lineup_id=lineup_id_value and player_id=removed[1];
  end if;
  -- Fill legacy unassigned slots as part of the same transaction, preserving pins.
  for r in select * from jsonb_to_recordset(assignments) x(player_id bigint,position text,slot_index integer) loop
    if r.player_id=any(added) then
      insert into lineup_players(lineup_id,player_id,roster_slot_position,roster_slot_index,projected_fantasy_points,projection_confidence,projection_source,projected_at)
        values(lineup_id_value,r.player_id,r.position,r.slot_index,
          (p_intent->'projection'->>'projected_fantasy_points')::numeric,p_intent->'projection'->>'projection_confidence',
          coalesce(p_intent->'projection'->>'projection_source',p_sport),(p_intent->'projection'->>'projected_at')::timestamptz);
    else update lineup_players set roster_slot_position=r.position,roster_slot_index=r.slot_index where lineup_id=lineup_id_value and player_id=r.player_id; end if;
  end loop;
  if correction or cardinality(removed)=1 then
    insert into draft_corrections(slate_id,group_id,league_id,sport,pick_id,team_id,old_player_id,new_player_id,actor_user_id,actor_name,old_player_name,new_player_name)
      values(p_slate_id,p_group_id,p_league_id,p_sport,pick_id_value,p_team_id,removed[1],added[1],p_actor_id,actor.display_name,
        case when p_sport='nfl' then (select name from players_nfl where id=removed[1]) else (select name from players where id=removed[1]) end,
        case when p_sport='nfl' then (select name from players_nfl where id=added[1]) else (select name from players where id=added[1]) end);
  else
    if p_sport='nfl' then select name,position into player_name_value,player_position_value from players_nfl where id=added[1];
    else select name,position_group into player_name_value,player_position_value from players where id=added[1]; end if;
    select * into r from jsonb_to_recordset(assignments) x(player_id bigint,position text,slot_index integer) where x.player_id=added[1];
    insert into draft_picks(slate_id,group_id,league_id,sport,overall_pick,round_number,pick_in_round,team_id,player_id,player_name,player_position,team_name,roster_slot_position,roster_slot_index,occurred_at,actor_user_id,actor_name,is_proxy,source)
      values(p_slate_id,p_group_id,p_league_id,p_sport,next_pick,round_index+1,offset_value+1,p_team_id,added[1],player_name_value,player_position_value,receiver.name,r.position,r.slot_index,clock_timestamp(),p_actor_id,actor.display_name,receiver.user_id is distinct from p_actor_id,'live');
  end if;
  perform set_config('app.fantasy_draft_mutation','off',true);
  return jsonb_build_object('lineupId',lineup_id_value,'addedPlayerIds',added,'removedPlayerIds',removed,'isPick',not correction and cardinality(added)=1,'overallPick',next_pick);
end;
$$;

-- Fail closed for old app versions, direct browser writes, imports, and slate
-- deletion paths. Golf follows its existing path. A service-role caller cannot
-- directly insert history; only the reviewed RPC owner can write these tables.
create function public.guard_fantasy_roster_write() returns trigger language plpgsql security definer set search_path=public as $$
declare target_slate bigint; target_sport text;
begin
  if tg_table_name='lineup_players' then
    select l.slate_id,s.sport into target_slate,target_sport from lineups l join slates s on s.id=l.slate_id
      where l.id=case when tg_op='DELETE' then old.lineup_id else new.lineup_id end;
    if tg_op='UPDATE' and old.lineup_id<>new.lineup_id and (target_sport in ('nba','nfl') or exists(
      select 1 from lineups l join slates s on s.id=l.slate_id where l.id=old.lineup_id and s.sport in ('nba','nfl')))
      then raise exception 'Moving fantasy lineup player rows is not supported'; end if;
  else
    target_slate := case when tg_op='DELETE' then old.slate_id else new.slate_id end;
    select sport into target_sport from slates where id=target_slate;
    if tg_op='UPDATE' and (old.slate_id<>new.slate_id or old.team_id<>new.team_id) and
      (target_sport in ('nba','nfl') or exists(select 1 from slates where id=old.slate_id and sport in ('nba','nfl')))
      then raise exception 'Moving fantasy lineups is not supported'; end if;
  end if;
  if target_sport in ('nba','nfl') then
    perform 1 from slates where id=target_slate for update;
    if current_setting('app.fantasy_draft_mutation',true) is distinct from 'on' then raise exception 'Use the authoritative fantasy draft/correction API'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger fantasy_roster_write_guard before insert or update or delete on public.lineup_players for each row execute function public.guard_fantasy_roster_write();
create trigger fantasy_lineup_write_guard before insert or update or delete on public.lineups for each row execute function public.guard_fantasy_roster_write();

create function public.guard_fantasy_history() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_table_name='draft_picks' and tg_op='UPDATE' and old.status='active' and new.status='reversed'
    and current_setting('app.fantasy_draft_mutation',true)='on'
    and (to_jsonb(old)-array['status','reversed_at','reversed_by'])=(to_jsonb(new)-array['status','reversed_at','reversed_by']) then return new; end if;
  raise exception 'Draft history/configuration is immutable; record a correction';
end;
$$;
create trigger draft_picks_immutable before update or delete on public.draft_picks for each row execute function public.guard_fantasy_history();
create trigger draft_corrections_immutable before update or delete on public.draft_corrections for each row execute function public.guard_fantasy_history();
create trigger fantasy_drafts_immutable before update or delete on public.fantasy_drafts for each row execute function public.guard_fantasy_history();

create function public.guard_fantasy_configuration() returns trigger language plpgsql security definer set search_path=public as $$
declare slate_value bigint;
begin
  if tg_table_name='slates' then
    if old.sport in ('nba','nfl') and exists(select 1 from fantasy_drafts where slate_id=old.id)
      and (new.sport is distinct from old.sport or new.league_id is distinct from old.league_id
        or new.rules_snapshot is distinct from old.rules_snapshot or new.rules_version is distinct from old.rules_version)
      then raise exception 'Draft rules and ownership are frozen'; end if;
    return new;
  end if;
  slate_value := case when tg_op='DELETE' then old.slate_id else new.slate_id end;
  if tg_op='UPDATE' and old.slate_id<>new.slate_id and exists(select 1 from fantasy_drafts where slate_id=old.slate_id)
    then raise exception 'Draft participant order is frozen'; end if;
  perform 1 from slates where id=slate_value for update;
  if exists(select 1 from fantasy_drafts where slate_id=slate_value)
    and (tg_op<>'UPDATE' or to_jsonb(new) is distinct from to_jsonb(old)) then raise exception 'Draft participant order is frozen'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger fantasy_slate_configuration_guard before update on public.slates for each row execute function public.guard_fantasy_configuration();
create trigger fantasy_participant_configuration_guard before insert or update or delete on public.slate_teams for each row execute function public.guard_fantasy_configuration();

revoke all on function public.fantasy_slot_eligible(text,text,text), public.read_fantasy_draft(bigint,uuid,uuid,text),
  public.mutate_fantasy_draft(bigint,uuid,uuid,text,bigint,uuid,jsonb), public.guard_fantasy_roster_write(),
  public.guard_fantasy_history(), public.guard_fantasy_configuration() from public,anon,authenticated;
grant execute on function public.read_fantasy_draft(bigint,uuid,uuid,text), public.mutate_fantasy_draft(bigint,uuid,uuid,text,bigint,uuid,jsonb) to service_role;
commit;
