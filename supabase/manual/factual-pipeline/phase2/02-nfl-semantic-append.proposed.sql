-- PROPOSAL ONLY. Requires signed-yard proposal first and coordinated writer cutover.
-- This replaces lifetime hash uniqueness, NOT existing hashes, IDs, facts or views.
-- Incompatible with legacy ON CONFLICT(four columns); do not install piecemeal.
-- New writer remains owner-only. No application uses this function in this phase.
begin;
set local search_path=pg_catalog,public;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $$
declare c record;
begin
  if current_setting('sports111.factual_schema_approval',true) is distinct from 'rehearsal:nfl_semantic_v1' then
    raise exception 'Reviewed isolated NFL semantic rehearsal required'; end if;
  lock table public.nfl_player_game_observation_versions in access exclusive mode;
  if not has_table_privilege('service_role','public.nfl_player_game_observation_versions','INSERT') then
    raise exception 'Legacy NFL writer grant differs from reviewed cutover'; end if;
  if not (select relrowsecurity from pg_class where oid='public.nfl_player_game_observation_versions'::regclass)
    or not exists(select 1 from pg_trigger where tgrelid='public.nfl_player_game_observation_versions'::regclass
      and tgname='nfl_observation_versions_immutable' and tgenabled='O'
      and tgfoid='public.reject_nfl_projection_observation_version_mutation()'::regprocedure)
    or exists(select 1 from pg_constraint where conrelid='public.nfl_player_game_observation_versions'::regclass
      and contype='c' and pg_get_constraintdef(oid) ~ '(passing_yards|rushing_yards|receiving_yards).*>=') then
    raise exception 'NFL protections or signed-yard prerequisite changed'; end if;
  select conname,pg_get_constraintdef(oid) as definition into strict c from pg_constraint
    where conrelid='public.nfl_player_game_observation_versions'::regclass and contype='u'
      and pg_get_constraintdef(oid)='UNIQUE (provider, provider_player_id, provider_event_id, observation_hash)';
  -- Preserve exact legacy constraint name/definition for unused-only rollback.
  execute format('alter table public.nfl_player_game_observation_versions drop constraint %I',c.conname);
  create unique index nfl_observation_legacy_hash_unique on public.nfl_player_game_observation_versions
    (provider,provider_player_id,provider_event_id,observation_hash);
  execute format('comment on index public.nfl_observation_legacy_hash_unique is %L',jsonb_build_object('name',c.conname,'definition',c.definition)::text);
end $$;

create table public.nfl_observation_append_receipts (
  id uuid primary key,
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  accepted integer not null check(accepted between 1 and 200),
  appended integer not null check(appended between 0 and accepted),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.nfl_player_game_observation_versions
  add column semantic_receipt_id uuid references public.nfl_observation_append_receipts(id) on delete restrict deferrable initially deferred,
  add column semantic_ordinal integer,
  add constraint nfl_semantic_receipt_pair check((semantic_receipt_id is null and semantic_ordinal is null)
    or (semantic_receipt_id is not null and semantic_ordinal is not null and semantic_ordinal between 1 and 200)),
  add constraint nfl_semantic_receipt_row unique(semantic_receipt_id,semantic_ordinal);
-- Rebuild only the temporary replacement index, preserving its rollback comment.
do $$ declare note text; begin
  note:=obj_description('public.nfl_observation_legacy_hash_unique'::regclass,'pg_class');
  drop index public.nfl_observation_legacy_hash_unique;
  create unique index nfl_observation_legacy_hash_unique on public.nfl_player_game_observation_versions
    (provider,provider_player_id,provider_event_id,observation_hash) where semantic_receipt_id is null;
  execute format('comment on index public.nfl_observation_legacy_hash_unique is %L',note);
end $$;

-- High water includes identical polls, which deliberately have no version row.
create table public.nfl_observation_append_heads (
  provider text not null check(provider='espn'),
  provider_player_id text not null,
  provider_event_id text not null,
  acquired_through timestamptz not null,
  game_log_through timestamptz not null,
  fumble_summary_through timestamptz,
  known_through timestamptz not null,
  latest_version_id bigint not null references public.nfl_player_game_observation_versions(id) on delete restrict,
  primary key(provider,provider_player_id,provider_event_id)
);
create function public.reject_nfl_append_receipt_mutation() returns trigger language plpgsql as $$
begin raise exception 'NFL append receipts are immutable'; end $$;
create trigger nfl_append_receipt_immutable before update or delete on public.nfl_observation_append_receipts
  for each row execute function public.reject_nfl_append_receipt_mutation();

create function public.propose_append_nfl_observations(p_receipt uuid,p_observations jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.nfl_player_game_observation_versions%rowtype; latest public.nfl_player_game_observation_versions%rowtype;
  head public.nfl_observation_append_heads%rowtype; receipt public.nfl_observation_append_receipts%rowtype;
  input record; key_row record; digest text; n integer:=0; ordinal integer; acquired timestamptz; fact jsonb; previous_fact jsonb;
  fact_keys text[]:=array['provider','provider_player_id','provider_event_id','local_player_id','position','season','week','phase',
    'game_at','completed_at','team_provider_id','team_abbreviation','opponent_provider_id','opponent_abbreviation','home_away',
    'completions','passing_attempts','passing_yards','passing_touchdowns','interceptions','rushing_attempts','rushing_yards',
    'rushing_touchdowns','receiving_targets','receptions','receiving_yards','receiving_touchdowns','fumbles_lost'];
begin
  if p_receipt is null or jsonb_typeof(p_observations) is distinct from 'array' then raise exception 'Receipt and bounded array required'; end if;
  if jsonb_array_length(p_observations) not between 1 and 200 or octet_length(p_observations::text)>2500000 then raise exception 'NFL append batch bound exceeded'; end if;
  digest:=encode(sha256(convert_to(p_observations::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('nfl_receipt',p_receipt)::text,0));
  select * into receipt from public.nfl_observation_append_receipts where id=p_receipt;
  if found then
    if receipt.payload_hash<>digest then raise exception 'Receipt ID reused with different payload'; end if;
    return jsonb_build_object('receipt',to_jsonb(receipt),'appended_this_call',0,'replayed',true);
  end if;
  -- Lock every key in stable order BEFORE processing any row. No worker can
  -- interleave an A/B/A batch. Hash collisions serialize harmlessly.
  for key_row in select distinct e->>'provider' as provider,e->>'provider_player_id' as player,e->>'provider_event_id' as event
    from jsonb_array_elements(p_observations) e order by 1,2,3 loop
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('nfl_semantic',key_row.provider,key_row.player,key_row.event)::text,0));
  end loop;
  for input in select e.payload,e.ordinality from jsonb_array_elements(p_observations) with ordinality e(payload,ordinality)
    order by e.payload->>'provider',e.payload->>'provider_player_id',e.payload->>'provider_event_id',
      (e.payload->>'known_at')::timestamptz,(e.payload->>'game_log_fetched_at')::timestamptz,e.ordinality loop
    if jsonb_typeof(input.payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input.payload) k
      where not(k=any(fact_keys||array['game_log_source_url','game_log_fetched_at','fumble_summary_source_url',
        'fumble_summary_fetched_at','known_at','normalization_version','observation_hash']))) then raise exception 'Unexpected NFL observation fields'; end if;
    r:=jsonb_populate_record(null::public.nfl_player_game_observation_versions,input.payload);
    acquired:=greatest(r.game_log_fetched_at,r.fumble_summary_fetched_at);
    if r.provider is distinct from 'espn' or r.local_player_id is null or r.known_at is null or acquired is null
      or r.game_log_fetched_at is null or r.known_at<acquired or r.known_at>clock_timestamp()+interval '5 seconds'
      or r.game_log_source_url is null or r.game_log_source_url !~ '^https://' or r.normalization_version is null
      or r.observation_hash is null or r.observation_hash !~ '^[a-f0-9]{64}$' or
      not exists(select 1 from public.players_nfl p where p.id=r.local_player_id and p.nfl_player_id::text=r.provider_player_id
        and p.nfl_player_id<100000000) then raise exception 'Reviewed NFL identity and acquisition provenance required'; end if;
    select * into head from public.nfl_observation_append_heads where provider=r.provider and provider_player_id=r.provider_player_id and provider_event_id=r.provider_event_id;
    if found then
      select * into strict latest from public.nfl_player_game_observation_versions where id=head.latest_version_id;
    else
      select * into latest from public.nfl_player_game_observations where provider=r.provider and provider_player_id=r.provider_player_id and provider_event_id=r.provider_event_id;
      head.acquired_through:=greatest(latest.game_log_fetched_at,latest.fumble_summary_fetched_at);
      head.game_log_through:=latest.game_log_fetched_at;
      head.fumble_summary_through:=latest.fumble_summary_fetched_at;
      head.known_through:=latest.known_at;
    end if;
    if acquired<head.acquired_through or r.known_at<head.known_through or r.game_log_fetched_at<head.game_log_through
      or r.fumble_summary_fetched_at<head.fumble_summary_through then raise exception 'Out-of-order NFL acquisition requires separate historical review'; end if;
    select jsonb_object_agg(k,to_jsonb(r)->k) into fact from unnest(fact_keys) k;
    select jsonb_object_agg(k,to_jsonb(latest)->k) into previous_fact from unnest(fact_keys) k;
    if latest.id is null or fact is distinct from previous_fact then
      if latest.id is not null and (r.known_at=head.known_through or acquired=head.acquired_through) then
        raise exception 'Conflicting NFL facts at an ambiguous acquisition boundary'; end if;
      insert into public.nfl_player_game_observation_versions(provider,provider_player_id,provider_event_id,local_player_id,position,season,week,phase,
        game_at,completed_at,team_provider_id,team_abbreviation,opponent_provider_id,opponent_abbreviation,home_away,
        completions,passing_attempts,passing_yards,passing_touchdowns,interceptions,rushing_attempts,rushing_yards,rushing_touchdowns,
        receiving_targets,receptions,receiving_yards,receiving_touchdowns,fumbles_lost,game_log_source_url,game_log_fetched_at,
        fumble_summary_source_url,fumble_summary_fetched_at,known_at,normalization_version,observation_hash,semantic_receipt_id,semantic_ordinal)
      values(r.provider,r.provider_player_id,r.provider_event_id,r.local_player_id,r.position,r.season,r.week,r.phase,
        r.game_at,r.completed_at,r.team_provider_id,r.team_abbreviation,r.opponent_provider_id,r.opponent_abbreviation,r.home_away,
        r.completions,r.passing_attempts,r.passing_yards,r.passing_touchdowns,r.interceptions,r.rushing_attempts,r.rushing_yards,r.rushing_touchdowns,
        r.receiving_targets,r.receptions,r.receiving_yards,r.receiving_touchdowns,r.fumbles_lost,r.game_log_source_url,r.game_log_fetched_at,
        r.fumble_summary_source_url,r.fumble_summary_fetched_at,r.known_at,r.normalization_version,r.observation_hash,p_receipt,input.ordinality)
      returning * into latest;
      n:=n+1;
    end if;
    -- The table's checks normally validate inserted rows. Validate NO-CHANGE rows
    -- too: invalid counts/provenance must not be hidden by semantic suppression.
    if r.completed_at<r.game_at or r.known_at<r.game_log_fetched_at or
      (r.fumble_summary_source_url is null)<>(r.fumble_summary_fetched_at is null) then raise exception 'Invalid NFL provenance'; end if;
    insert into public.nfl_observation_append_heads values(r.provider,r.provider_player_id,r.provider_event_id,acquired,r.game_log_fetched_at,
      greatest(head.fumble_summary_through,r.fumble_summary_fetched_at),r.known_at,latest.id)
      on conflict(provider,provider_player_id,provider_event_id) do update set acquired_through=excluded.acquired_through,
        game_log_through=excluded.game_log_through,fumble_summary_through=excluded.fumble_summary_through,
        known_through=excluded.known_through,latest_version_id=excluded.latest_version_id;
  end loop;
  insert into public.nfl_observation_append_receipts(id,payload_hash,accepted,appended)
    values(p_receipt,digest,jsonb_array_length(p_observations),n) returning * into receipt;
  return jsonb_build_object('receipt',to_jsonb(receipt),'appended_this_call',n,'replayed',false);
end $$;
alter table public.nfl_observation_append_receipts enable row level security;
alter table public.nfl_observation_append_heads enable row level security;
revoke all on public.nfl_observation_append_receipts,public.nfl_observation_append_heads from public,anon,authenticated,service_role;
grant select on public.nfl_observation_append_receipts,public.nfl_observation_append_heads to service_role;
-- Deliberate cutover requirement: the old writer must NOT bypass semantic locks.
revoke insert on public.nfl_player_game_observation_versions from service_role;
revoke all on function public.propose_append_nfl_observations(uuid,jsonb),public.reject_nfl_append_receipt_mutation()
  from public,anon,authenticated,service_role;
commit;
