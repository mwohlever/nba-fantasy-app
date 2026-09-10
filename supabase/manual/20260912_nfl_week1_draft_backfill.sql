-- MANUAL ONLY. Exact human-supplied chronology, independently matched to live IDs.
-- Verified 2026-09-10T03:54:19.485Z. Never interpret created_at as actual pick time.
-- Authoritative pre-backfill revision: Kyle Pitts is the original pick #6.
-- This historical input revision creates no extra pick or correction event.
-- Strongly guarded one-time execution: a repeated run FAILS without changing rows.
-- 1. Jahmyr Gibbs (players_nfl.id=283, owner=Josh)
-- 2. Josh Allen (players_nfl.id=80, owner=Andy)
-- 3. Christian McCaffrey (players_nfl.id=774, owner=Mark)
-- 4. Bijan Robinson (players_nfl.id=44, owner=Jon)
-- 5. Puka Nacua (players_nfl.id=518, owner=Jon)
-- 6. Kyle Pitts Sr. (players_nfl.id=43, owner=Mark)
-- 7. Ja'Marr Chase (players_nfl.id=169, owner=Andy)
-- 8. Jonathan Taylor (players_nfl.id=385, owner=Josh)
-- 9. Jaxon Smith-Njigba (players_nfl.id=809, owner=Josh)
-- 10. Amon-Ra St. Brown (players_nfl.id=300, owner=Andy)
-- 11. Saquon Barkley (players_nfl.id=701, owner=Mark)
-- 12. James Cook III (players_nfl.id=85, owner=Jon)
-- 13. CeeDee Lamb (players_nfl.id=232, owner=Jon)
-- 14. Justin Jefferson (players_nfl.id=569, owner=Mark)
-- 15. De'Von Achane (players_nfl.id=532, owner=Andy)
-- 16. Nico Collins (players_nfl.id=335, owner=Josh)
-- 17. Trey McBride (players_nfl.id=18, owner=Josh)
-- 18. Chase Brown (players_nfl.id=166, owner=Andy)
-- 19. Lamar Jackson (players_nfl.id=66, owner=Mark)
-- 20. Jalen Hurts (players_nfl.id=711, owner=Jon)
-- 21. Colston Loveland (players_nfl.id=151, owner=Jon)
-- 22. Chris Olave (players_nfl.id=635, owner=Mark)
-- 23. Tyler Warren (players_nfl.id=388, owner=Andy)
-- 24. Bo Nix (players_nfl.id=270, owner=Josh)
begin;
select id from public.slates where id=179 for update;
lock table public.lineups, public.lineup_players, public.slate_teams in share row exclusive mode;
create temporary table verified_week1_picks (
  overall_pick integer primary key, player_id bigint unique not null,
  provider_id bigint unique not null, team_id bigint not null, lineup_id bigint not null,
  slot_position text not null, slot_index integer not null
) on commit drop;
insert into verified_week1_picks values
  (1, 283, 4429795, 2, 1062, 'RB', 0),
  (2, 80, 3918298, 1, 1063, 'QB', 0),
  (3, 774, 3117251, 4, 1064, 'RB', 0),
  (4, 44, 4430807, 3, 1065, 'RB', 1),
  (5, 518, 4426515, 3, 1065, 'WR', 1),
  (6, 43, 4360248, 4, 1064, 'TE', 0),
  (7, 169, 4362628, 1, 1063, 'WR', 0),
  (8, 385, 4242335, 2, 1062, 'RB', 1),
  (9, 809, 4430878, 2, 1062, 'WR', 1),
  (10, 300, 4374302, 1, 1063, 'WR', 1),
  (11, 701, 3929630, 4, 1064, 'RB', 1),
  (12, 85, 4379399, 3, 1065, 'RB', 0),
  (13, 232, 4241389, 3, 1065, 'WR', 0),
  (14, 569, 4262921, 4, 1064, 'WR', 0),
  (15, 532, 4429160, 1, 1063, 'RB', 0),
  (16, 335, 4258173, 2, 1062, 'WR', 0),
  (17, 18, 4361307, 2, 1062, 'TE', 0),
  (18, 166, 4362238, 1, 1063, 'RB', 1),
  (19, 66, 3916387, 4, 1064, 'QB', 0),
  (20, 711, 4040715, 3, 1065, 'QB', 0),
  (21, 151, 4723086, 3, 1065, 'TE', 0),
  (22, 635, 4361370, 4, 1064, 'WR', 1),
  (23, 388, 4431459, 1, 1063, 'TE', 0),
  (24, 270, 4426338, 2, 1062, 'QB', 0);

do $verify$
declare participant_ids bigint[]; roster_size integer;
begin
  if not exists(select 1 from public.slates s join public.leagues l on l.id=s.league_id
    join public.groups g on g.id=l.group_id
    where s.id=179 and s.sport='nfl' and s.display_name='2026 Week 1'
      and s.start_date='2026-09-09' and s.end_date='2026-09-14'
      and s.league_id='dc82641b-6a31-4044-aa90-e02dcb305c54' and l.sport_key='nfl'
      and g.id='2ac845fb-93c8-4781-aa38-e206a76f46cb' and g.slug='111'
      and s.rules_version=5 and s.rules_snapshot=$rules${"draft":{"type":"snake"},"sport":"nfl","roster":{"slots":[{"position":"QB","slotCount":1},{"position":"RB","slotCount":2},{"position":"WR","slotCount":2},{"position":"TE","slotCount":1},{"position":"K","slotCount":0},{"position":"FLEX","slotCount":0},{"position":"SF","slotCount":0},{"position":"D/ST","slotCount":0}]},"scoring":{"dstSacks":5,"receptions":0.5,"dstSafeties":2,"fumblesLost":-2,"passingYards":0.04,"rushingYards":0.1,"dstTouchdowns":6,"receivingYards":0.1,"dstInterceptions":2,"dstPointsAllowed0":10,"passingTouchdowns":5,"rushingTouchdowns":6,"dstFumbleRecoveries":2,"receivingTouchdowns":6,"dstPointsAllowed1To6":7,"passingInterceptions":-2,"dstPointsAllowed7To13":4,"dstPointsAllowed14To20":1,"dstPointsAllowed21To27":0,"dstPointsAllowed28To34":-1,"dstPointsAllowed35Plus":-4,"dstYardsAllowed450Plus":-5,"dstYardsAllowed100To199":3,"dstYardsAllowed200To299":2,"dstYardsAllowed300To349":0,"dstYardsAllowed350To399":-1,"dstYardsAllowed400To449":-3,"dstYardsAllowedUnder100":5},"schemaVersion":1}$rules$::jsonb)
    then raise exception 'Week 1 slate, scope or frozen rules changed; STOP'; end if;
  if exists(select 1 from public.fantasy_drafts where slate_id=179)
    or exists(select 1 from public.draft_picks where slate_id=179)
    or exists(select 1 from public.draft_corrections where slate_id=179)
    then raise exception 'History already exists; STOP (do not rerun or merge histories)'; end if;
  select array_agg(team_id order by draft_order) into participant_ids from public.slate_teams where slate_id=179 and is_participating;
  if participant_ids is distinct from array[2,1,4,3]::bigint[]
    or exists(select 1 from (select draft_order,row_number() over(order by draft_order) n from public.slate_teams where slate_id=179 and is_participating) x where draft_order is distinct from n)
    then raise exception 'Participant order changed; STOP'; end if;
  if exists(select 1 from unnest(participant_ids) as participant(team_id) where not exists(
    select 1 from public.teams t join public.group_memberships gm on gm.user_id=t.user_id and gm.group_id=t.group_id
    where t.id=participant.team_id and t.group_id='2ac845fb-93c8-4781-aa38-e206a76f46cb' and gm.is_active))
    then raise exception 'Participant Group membership changed; STOP'; end if;
  select sum((x->>'slotCount')::integer) into roster_size from public.slates s,
    jsonb_array_elements(s.rules_snapshot->'roster'->'slots') x where s.id=179;
  if roster_size<>6 or cardinality(participant_ids)*roster_size<>24
    then raise exception 'Draft capacity changed; STOP'; end if;
  if (select count(*) from verified_week1_picks)<>24 or (select min(overall_pick) from verified_week1_picks)<>1
    or (select max(overall_pick) from verified_week1_picks)<>24 then raise exception 'Expected exactly picks 1-24'; end if;
  if exists(select 1 from verified_week1_picks v where not exists(select 1 from public.players_nfl p where p.id=v.player_id and p.nfl_player_id=v.provider_id
    and public.fantasy_slot_eligible('nfl',p.position,v.slot_position)))
    then raise exception 'Canonical NFL player/provider identity changed; STOP'; end if;
  if (select count(*) from public.lineups where slate_id=179)<>cardinality(participant_ids)
    or (select count(*) from public.lineup_players lp join public.lineups l on l.id=lp.lineup_id where l.slate_id=179)<>24
    or exists(select 1 from verified_week1_picks v where not exists(
      select 1 from public.lineups l join public.lineup_players lp on lp.lineup_id=l.id
      where l.slate_id=179 and l.id=v.lineup_id and l.team_id=v.team_id and lp.player_id=v.player_id
        and lp.sport='nfl' and lp.roster_slot_position=v.slot_position and lp.roster_slot_index=v.slot_index))
    then raise exception 'Current roster ownership/slots changed; STOP'; end if;
  if exists(select 1 from verified_week1_picks v where v.team_id <> participant_ids[
    case when ((v.overall_pick-1)/cardinality(participant_ids))%2=0
      then ((v.overall_pick-1)%cardinality(participant_ids))+1
      else cardinality(participant_ids)-((v.overall_pick-1)%cardinality(participant_ids)) end])
    then raise exception 'Supplied chronology does not match the configured snake; STOP'; end if;
end;
$verify$;
insert into public.fantasy_drafts(slate_id,group_id,league_id,sport,participant_ids,roster_slots,rules_snapshot)
select s.id,'2ac845fb-93c8-4781-aa38-e206a76f46cb',s.league_id,s.sport,
  (select array_agg(team_id order by draft_order) from public.slate_teams where slate_id=179 and is_participating),
  (select jsonb_agg(jsonb_build_object('position',x->>'position','slot_count',(x->>'slotCount')::integer) order by n)
    from jsonb_array_elements(s.rules_snapshot->'roster'->'slots') with ordinality q(x,n)),s.rules_snapshot
from public.slates s where s.id=179;
insert into public.draft_picks(slate_id,group_id,league_id,sport,overall_pick,round_number,pick_in_round,
  team_id,player_id,player_name,player_position,team_name,roster_slot_position,roster_slot_index,
  occurred_at,actor_user_id,is_proxy,source)
select d.slate_id,d.group_id,d.league_id,d.sport,v.overall_pick,
  ((v.overall_pick-1)/cardinality(d.participant_ids))+1,((v.overall_pick-1)%cardinality(d.participant_ids))+1,
  v.team_id,v.player_id,p.name,p.position,t.name,v.slot_position,v.slot_index,
  null,null,null,'verified_backfill'
from verified_week1_picks v join public.players_nfl p on p.id=v.player_id
join public.teams t on t.id=v.team_id join public.fantasy_drafts d on d.slate_id=179
order by v.overall_pick;
commit;
