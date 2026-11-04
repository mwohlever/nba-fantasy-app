#!/usr/bin/env python3
"""Archive-bound cleanup. Default production path is READ ONLY; never auto-compacts."""
import argparse
import contextlib
from datetime import datetime, timezone
from decimal import Decimal
import email.utils
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import sqlite3
import tempfile
import time
import urllib.request
import base64

import psycopg
from psycopg.rows import dict_row

HERE = Path(__file__).resolve().parent
PROJECT = 'oororafwujfliscjasur'
CUTOFF = 1502203
MIB = 1024 ** 2
RESERVE = 256 * MIB
AUTH_TOKEN = 'AUTHORIZE_PRODUCTION_NBA_CLEANUP_1502203'
FIELDS = ('id provider provider_player_id provider_event_id local_player_id season phase game_at completed_at '
          'team_provider_id team_abbreviation opponent_provider_id opponent_abbreviation home_away minutes '
          'points rebounds assists steals blocks turnovers source_url provider_fetched_at provider_known_at '
          'normalization_version observation_hash created_at').split()
TRANSIENT = {'id', 'created_at', 'provider_fetched_at', 'provider_known_at', 'observation_hash'}
FACTS = [x for x in FIELDS if x not in TRANSIENT]
NUMERIC = set('minutes points rebounds assists steals blocks turnovers'.split())
INTEGERS = {'id', 'local_player_id', 'season'}
TIMES = {'game_at', 'completed_at', 'provider_fetched_at', 'provider_known_at', 'created_at'}
RUNTIME_FILES = ['cleanup_runner.py', 'runner-setup.sql', 'runner-validate.sql',
                 'runner-postcheck.sql', 'runner-requirements.txt', 'run-runner.sh']


class Stop(RuntimeError):
    pass


class StorageStop(Stop):
    pass


def require(condition, message):
    if not condition:
        raise Stop(message)


def dumps(value):
    return json.dumps(value, default=str, sort_keys=True, separators=(',', ':'))


def loads(value):
    return json.loads(value, parse_float=Decimal)


def digest(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def package_digest():
    return hashlib.sha256(''.join(name + ':' + digest(HERE / name) for name in RUNTIME_FILES).encode()).hexdigest()


def timestamp(value):
    result = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None, 'Naive timestamp in archive/live row')
    return result.astimezone(timezone.utc).isoformat(timespec='microseconds')


def canonical(row):
    require(set(row) == set(FIELDS), 'Observation schema differs from archived schema')
    result = []
    for name in FIELDS:
        value = row[name]
        if value is not None:
            if name in TIMES:
                value = timestamp(value)
            elif name in NUMERIC:
                value = format(Decimal(str(value)).normalize(), 'f')
            elif name in INTEGERS:
                value = int(value)
        result.append(value)
    return tuple(result)


def verified_files(base):
    allowed = {'observations.dump', 'public-schema.sql', 'metadata.json', 'archive.contents'}
    seen = set()
    for line in (base / 'archive.sha256').read_text().splitlines():
        expected, name = line.split('  ', 1)
        require(name in allowed and name not in seen, 'Unexpected archive receipt entry')
        require(digest(base / name) == expected, 'Archive checksum mismatch: ' + name)
        seen.add(name)
    require(seen == allowed, 'Incomplete archive receipt')


class Manifest:
    """Disk-backed local manifest. SQLite files are never copied into production."""
    def __init__(self, base, strict=True):
        self.base = Path(base)
        self.metadata = loads((self.base / 'metadata.json').read_text())
        self.ready = loads((self.base / 'review-batches/READY.json').read_text())
        verified_files(self.base)
        self.source_sha = digest(self.base / 'manifest.jsonl')
        require(self.source_sha == self.ready['manifest_sha256'], 'Manifest digest mismatch')
        m = self.metadata
        if strict:
            require((m['cutoff'], m['expected_versions'], m['expected_current'],
                     m['expected_retained'], m['expected_candidates'], m['watermark'])
                    == (CUTOFF, 1502003, 34386, 68772, 1433231, CUTOFF), 'Unapproved production scope')
        self.path = self.base / 'runner-manifest.sqlite'
        receipt = self.base / 'runner-manifest-receipt.json'
        if not self.path.exists():
            self._build()
            receipt.write_text(dumps({'sha256': digest(self.path), 'source_sha256': self.source_sha}))
        require(receipt.exists(), 'Cache receipt absent; preserve and investigate cache')
        info = loads(receipt.read_text())
        require(info['source_sha256'] == self.source_sha and info['sha256'] == digest(self.path), 'Manifest cache changed')
        self.cache_sha = info['sha256']
        self.db = sqlite3.connect(f'file:{self.path}?mode=ro', uri=True)
        self.db.row_factory = sqlite3.Row
        require(self.db.execute('PRAGMA quick_check').fetchone()[0] == 'ok', 'Manifest cache corrupt')

    def _build(self):
        fd, temporary = tempfile.mkstemp(prefix='runner-manifest-', suffix='.partial', dir=self.base)
        os.close(fd)
        db = sqlite3.connect(temporary)
        try:
            db.executescript('''PRAGMA cache_size=-32768;
              CREATE TABLE keys(key_no INTEGER PRIMARY KEY,provider TEXT,player TEXT,event TEXT,
                first_id INTEGER,last_id INTEGER,first_json TEXT,last_json TEXT,UNIQUE(provider,player,event));
              CREATE TABLE versions(id INTEGER PRIMARY KEY,key_no INTEGER,fetched TEXT,created TEXT,
                hash TEXT,keep INTEGER,UNIQUE(key_no,fetched));''')
            keys = versions = retained = 0
            high = 0
            previous = None
            with (self.base / 'manifest.jsonl').open() as file:
                for line in file:
                    k = loads(line)
                    require(k['eligible'] is True, 'Exceptional history in archived manifest')
                    f, l = k['first'], k['last']
                    normalized_first,normalized_last=canonical(f),canonical(l)
                    identity = tuple(f[n] for n in ('provider', 'provider_player_id', 'provider_event_id'))
                    require(previous is None or identity > previous, 'Duplicate/out-of-order key')
                    previous = identity
                    require(all(f[n] == l[n] for n in ('provider','provider_player_id','provider_event_id')), 'Boundary keys differ')
                    require(all(normalized_first[FIELDS.index(n)] == normalized_last[FIELDS.index(n)] for n in FACTS), 'Boundary facts differ')
                    records = k['observations']
                    require(len(records) in (43,44) and f['id'] != l['id'], 'Unexpected archived history length')
                    ordered = sorted(records, key=lambda r: (timestamp(r['provider_fetched_at']), r['id']))
                    require((ordered[0]['id'],ordered[-1]['id']) == (f['id'],l['id']), 'Wrong chronological boundaries')
                    require(f['provider_known_at'] == f['provider_fetched_at'] and l['provider_known_at'] == l['provider_fetched_at'], 'Exceptional boundary availability')
                    keys += 1
                    db.execute('INSERT INTO keys VALUES(?,?,?,?,?,?,?,?)',
                        (keys,*identity,f['id'],l['id'],dumps(f),dumps(l)))
                    for row in records:
                        identifier = int(row['id'])
                        require(1 <= identifier <= CUTOFF, 'Archive ID outside approved cutoff')
                        fetched = timestamp(row['provider_fetched_at'])
                        require(fetched >= timestamp(f['game_at']) and
                                (f['completed_at'] is None or fetched >= timestamp(f['completed_at'])), 'Invalid availability')
                        require(len(row['observation_hash']) == 64, 'Invalid archived hash')
                        keep = identifier in (f['id'],l['id'])
                        if keep:
                            b = f if identifier == f['id'] else l
                            require((fetched,timestamp(row['created_at']),row['observation_hash']) ==
                                    (timestamp(b['provider_fetched_at']),timestamp(b['created_at']),b['observation_hash']), 'Boundary metadata mismatch')
                        db.execute('INSERT INTO versions VALUES(?,?,?,?,?,?)',
                            (identifier,keys,fetched,timestamp(row['created_at']),row['observation_hash'],int(keep)))
                        versions += 1; retained += int(keep); high = max(high,identifier)
                    if keys % 1000 == 0:
                        db.commit()
                    if keys % 5000 == 0:
                        print(dumps({'event':'building_local_manifest_cache','keys':keys,'versions':versions}),flush=True)
            m = self.metadata
            require((keys,versions,retained,high) ==
                    (m['expected_current'],m['expected_versions'],m['expected_retained'],m['watermark']), 'Archive/cache totals differ')
            require(versions-retained == m['expected_candidates'], 'Candidate total mismatch')
            db.execute('CREATE INDEX versions_key ON versions(key_no)')
            db.commit(); db.close()
            Path(temporary).rename(self.path)
        except BaseException:
            db.close()
            Path(temporary).unlink(missing_ok=True)
            raise

    def keys(self, numbers=None, with_versions=True):
        if numbers is None:
            rows = self.db.execute('SELECT * FROM keys ORDER BY key_no')
        else:
            rows = self.db.execute('SELECT * FROM keys WHERE key_no IN (' + ','.join('?' for _ in numbers) + ') ORDER BY key_no', numbers)
        result = []
        for row in rows:
            k = dict(row)
            k['first'] = loads(k.pop('first_json')); k['last'] = loads(k.pop('last_json'))
            if with_versions:
                k['versions'] = [dict(v) for v in self.db.execute('SELECT * FROM versions WHERE key_no=? ORDER BY id',(k['key_no'],))]
            result.append(k)
        return result

    def chunks(self, size=250, with_versions=True):
        last = self.metadata['expected_current']
        for start in range(1,last+1,size):
            yield self.keys(list(range(start,min(start+size,last+1))),with_versions=with_versions)


class Ledger:
    def __init__(self, path):
        self.path = Path(path)
        self.file = self.path.open('a')
        self.last_commit = None
        os.chmod(self.path,0o600)

    def emit(self, event, **values):
        item = {'time':datetime.now(timezone.utc).isoformat(),'event':event,**values}
        self.file.write(dumps(item)+'\n'); self.file.flush(); os.fsync(self.file.fileno())
        if event=='committed': self.last_commit=item
        print(dumps(item),flush=True)


HEALTH = '''SELECT current_setting('transaction_read_only') AS read_only,
  current_database() AS database,current_user AS role,version() AS version,
  inet_server_addr()::text AS server_address,current_setting('data_directory') AS data_directory,
  (SELECT count(*) FROM public.nba_player_game_current_observations) AS current_count,
  (SELECT md5(string_agg(md5(to_jsonb(c)::text),'' ORDER BY provider,provider_player_id,provider_event_id))
    FROM public.nba_player_game_current_observations c) AS current_checksum,
  (SELECT id FROM public.nba_player_game_observation_versions ORDER BY id DESC LIMIT 1) AS watermark,
  (SELECT jsonb_build_object('last_value',last_value,'is_called',is_called)
    FROM public.nba_player_game_observation_versions_id_seq) AS sequence,
  (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.nba_player_game_observation_versions'::regclass
    AND NOT tgisinternal) AS trigger_count,
  (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.nba_player_game_observation_versions'::regclass
    AND ((tgname='nba_observation_versions_immutable' AND tgfoid='public.reject_nba_projection_observation_version_mutation()'::regprocedure)
      OR (tgname='nba_observation_versions_sync_current' AND tgfoid='public.sync_nba_current_observation()'::regprocedure))
    AND tgenabled='O') AS enabled_expected_triggers,
  ARRAY(SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE oid=ANY(ARRAY[
    'public.append_nba_projection_observations(jsonb)'::regprocedure,
    'public.sync_nba_current_observation()'::regprocedure,
    'public.reject_nba_projection_observation_version_mutation()'::regprocedure])) AS routine_hashes,
  (SELECT count(*) FROM pg_constraint WHERE contype='f'
    AND confrelid='public.nba_player_game_observation_versions'::regclass) AS incoming_fks,
  (SELECT count(*) FROM pg_constraint WHERE contype='f'
    AND confrelid='public.nba_player_game_observation_versions'::regclass
    AND conrelid='public.nba_player_game_current_observations'::regclass
    AND confdeltype='r' AND convalidated) AS restrictive_current_fk,
  (SELECT bool_and(convalidated) FROM pg_constraint WHERE conrelid IN
    ('public.nba_player_game_observation_versions'::regclass,'public.nba_player_game_current_observations'::regclass)) AS constraints_valid,
  (SELECT count(*) FROM pg_index WHERE indrelid='public.nba_player_game_observation_versions'::regclass
    AND indisvalid AND indisready) AS valid_indexes,
  (SELECT count(*) FROM pg_class WHERE oid IN ('public.nba_player_game_observation_versions'::regclass,
    'public.nba_player_game_current_observations'::regclass) AND relrowsecurity) AS rls_tables,
  pg_database_size(current_database()) AS database_bytes,
  pg_current_wal_lsn()::text AS wal_lsn,
  (SELECT sum(size) FROM pg_ls_waldir()) AS wal_bytes,
  (SELECT wal_bytes FROM pg_stat_wal) AS wal_generated_bytes,
  (SELECT wal_fpi FROM pg_stat_wal) AS wal_fpi,
  current_setting('wal_compression') AS wal_compression,
  (SELECT count(*) FROM pg_replication_slots) AS slots,
  (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid()
    AND xact_start<clock_timestamp()-interval '60 seconds') AS long_transactions'''


def lsn(value):
    high,low = value.split('/')
    return (int(high,16)<<32)+int(low,16)


class Database:
    def __init__(self, conn, manifest, local=False):
        self.conn,self.manifest,self.local = conn,manifest,local

    @contextlib.contextmanager
    def read(self, repeatable=False):
        with self.conn.transaction():
            self.conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY' if repeatable else 'SET TRANSACTION READ ONLY')
            yield self.conn.cursor()

    def health(self, cur=None):
        if cur is None:
            with self.read() as cursor:
                return self.health(cursor)
        h = cur.execute(HEALTH).fetchone()
        m = self.manifest.metadata
        require(h['current_count']==m['expected_current'] and h['current_checksum']==m['current_checksum'], 'Current observations changed')
        require(h['watermark']==m['watermark'], 'History watermark changed')
        require(h['sequence']==m['sequence'], 'History identity sequence changed')
        require(h['trigger_count']==2 and h['enabled_expected_triggers']==2, 'History trigger state changed')
        require(sorted(h['routine_hashes'])==sorted(hashlib.md5(x.encode()).hexdigest() for x in m['routines']), 'Observation routine definitions changed')
        require(h['incoming_fks']==1 and h['restrictive_current_fk']==1, 'Incoming FK inventory changed')
        require(h['constraints_valid'] and h['valid_indexes']==4 and h['rls_tables']==2, 'Constraints/indexes/RLS changed')
        require(h['slots']==0 and h['long_transactions']==0, 'Replication retention or long transaction detected')
        return h

    def schema(self,cur):
        names = [r['attname'] for r in cur.execute("SELECT attname FROM pg_attribute WHERE attrelid='public.nba_player_game_observation_versions'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")]
        require(set(names)==set(FIELDS),'History column schema changed')
        definitions = [r['definition'].strip() for r in cur.execute("SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid=ANY(ARRAY['public.append_nba_projection_observations(jsonb)'::regprocedure,'public.sync_nba_current_observation()'::regprocedure,'public.reject_nba_projection_observation_version_mutation()'::regprocedure])")]
        require(sorted(definitions)==sorted(x.strip() for x in self.manifest.metadata['routines']), 'Observation routines changed')

    def audit(self, expected_count=None, classify=False):
        pending=[]; completed=present=0
        with self.read(repeatable=True) as cur:
            health = self.health(cur); self.schema(cur)
            actual = cur.execute('SELECT count(*) AS n FROM public.nba_player_game_observation_versions').fetchone()['n']
            latest_errors=cur.execute('''SELECT count(*) AS n FROM public.nba_player_game_current_observations c
              LEFT JOIN LATERAL(SELECT id FROM public.nba_player_game_observation_versions v
                WHERE (v.provider,v.provider_player_id,v.provider_event_id)
                  =(c.provider,c.provider_player_id,c.provider_event_id)
                ORDER BY provider_fetched_at DESC,id DESC LIMIT 1) latest ON true
              WHERE latest.id IS DISTINCT FROM c.version_id''').fetchone()['n']
            require(latest_errors==0,'Current observations are not latest')
            for keys in self.manifest.chunks(with_versions=classify):
                bounds = {b['id']:b for k in keys for b in (k['first'],k['last'])}
                live = cur.execute('SELECT * FROM public.nba_player_game_observation_versions WHERE id=ANY(%s::bigint[])',(list(bounds),)).fetchall()
                require(len(live)==len(bounds),'Retained boundary missing')
                require(all(canonical(v)==canonical(bounds[v['id']]) for v in live),'Retained payload changed')
                if classify:
                    all_ids = [v['id'] for k in keys for v in k['versions']]
                    found = {r['id'] for r in cur.execute('SELECT id FROM public.nba_player_game_observation_versions WHERE id=ANY(%s::bigint[])',(all_ids,))}
                    present += len(found)
                    for k in keys:
                        ids={v['id'] for v in k['versions']}; kept={k['first_id'],k['last_id']}
                        state=found & ids
                        if state==ids: pending.append(k['key_no'])
                        elif state==kept: completed += len(ids)-2
                        else: raise Stop('Partial/unexpected history at key '+str(k['key_no']))
            require(expected_count is None or actual==expected_count,'Unexpected global history count')
            require(not classify or present==actual,'Orphan/unaccounted-for history rows')
            require(not classify or completed+actual==self.manifest.metadata['expected_versions'],'Resume counts inconsistent')
            return {'health':health,'history_count':actual,'retained_verified':self.manifest.metadata['expected_retained'],
                    'already_deleted':self.manifest.metadata['expected_versions']-actual,'pending_keys':pending}

    def setup(self):
        with self.conn.transaction():
            require(self.conn.execute("SELECT pg_try_advisory_lock(hashtextextended('111sports:nba-history-cleanup:1502203',0)) AS locked").fetchone()['locked'], 'Another cleanup runner holds the maintenance lock')
            for statement in (HERE/'runner-setup.sql').read_text().split(';'):
                if statement.strip(): self.conn.execute(statement)

    def apply(self, keys, max_seconds=25, hook=None):
        started=time.monotonic()
        expected=sum(len(k['versions'])-2 for k in keys)
        def execute(cur,query,params=None):
            remaining=max_seconds-(time.monotonic()-started)
            require(remaining>0,'Transaction-duration budget exhausted')
            cur.execute("SELECT set_config('statement_timeout',%s,true)",(str(max(1,int(remaining*1000))),))
            return cur.execute(query,params)
        with self.conn.transaction():
            cur=self.conn.cursor()
            execute(cur,"SET LOCAL lock_timeout='2s'")
            with cur.copy('COPY nr_keys FROM STDIN') as copy:
                for k in keys: copy.write_row((k['key_no'],k['provider'],k['player'],k['event'],k['first_id'],k['last_id'],len(k['versions'])))
            with cur.copy('COPY nr_boundaries ('+','.join(FIELDS)+') FROM STDIN') as copy:
                for k in keys:
                    for b in (k['first'],k['last']): copy.write_row([b[n] for n in FIELDS])
            with cur.copy('COPY nr_versions FROM STDIN') as copy:
                for k in keys:
                    for v in k['versions']: copy.write_row((k['key_no'],v['id'],v['fetched'],v['created'],v['hash'],bool(v['keep'])))
            execute(cur,'LOCK TABLE public.nba_player_game_observation_versions IN SHARE ROW EXCLUSIVE MODE')
            execute(cur,'LOCK TABLE public.nba_player_game_current_observations IN SHARE MODE')
            self.health(cur)
            validation=(HERE/'runner-validate.sql').read_text().replace('__FACTS_V__',','.join('v.'+x for x in FACTS)).replace('__FACTS_B__',','.join('b.'+x for x in FACTS))
            result=execute(cur,validation).fetchone()
            require(not any(result.values()),'Batch revalidation failed: '+dumps(result))
            if hook: hook('validated')
            execute(cur,'ALTER TABLE public.nba_player_game_observation_versions DISABLE TRIGGER nba_observation_versions_immutable')
            result=execute(cur,'''DELETE FROM public.nba_player_game_observation_versions v USING nr_versions e
              WHERE v.id=e.id AND NOT e.keep AND v.id<=1502203
              AND NOT EXISTS(SELECT 1 FROM public.nba_player_game_current_observations c WHERE c.version_id=v.id)''')
            deleted=result.rowcount
            if hook: hook('deleted')
            execute(cur,'ALTER TABLE public.nba_player_game_observation_versions ENABLE TRIGGER nba_observation_versions_immutable')
            require(deleted==expected,'Unexpected deletion count')
            result=execute(cur,(HERE/'runner-postcheck.sql').read_text()).fetchone()
            require(not any(result.values()),'Post-deletion integrity failure: '+dumps(result))
            self.health(cur)
            require(time.monotonic()-started<max_seconds,'Transaction deadline exceeded before commit')
            if hook: hook('before_commit')
        if hook: hook('committed')
        return {'deleted':deleted,'keys':len(keys),'seconds':round(time.monotonic()-started,3),
                'first_key':keys[0]['key_no'],'last_key':keys[-1]['key_no']}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


class Metrics:
    def __init__(self, local_path=None):
        self.local_path=local_path
        if local_path is None:
            values={}
            for line in (HERE.parents[3]/'.env.local').read_text().splitlines():
                if '=' not in line or line.lstrip().startswith('#'): continue
                key,value=line.split('=',1); value=value.strip()
                if value[:1] in ('"',"'") and value[-1:]==value[:1]: value=value[1:-1]
                values[key.strip()]=value
            require(values['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')==f'https://{PROJECT}.supabase.co','Metrics project mismatch')
            self.secret=values.get('SUPABASE_SECRET_KEY') or values['SUPABASE_SERVICE_ROLE_KEY']

    def sample(self):
        if self.local_path is not None:
            import shutil
            return {'available':shutil.disk_usage(self.local_path).free,'time':time.time(),'source':'local-filesystem'}
        request=urllib.request.Request(f'https://{PROJECT}.supabase.co/customer/v1/privileged/metrics',method='GET',
          headers={'Authorization':'Basic '+base64.b64encode(('service_role:'+self.secret).encode()).decode(),
                   'Cache-Control':'no-cache, max-age=0','Pragma':'no-cache'})
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=15) as response:
            require(response.headers.get('Date') is not None,'Metrics freshness header missing')
            served=email.utils.parsedate_to_datetime(response.headers['Date']).timestamp()
            require(abs(time.time()-served)<30 and float(response.headers.get('Age','0'))<=90,'Stale metrics response')
            raw=response.read().decode()
        values={}
        for line in raw.splitlines():
            if not line or line.startswith('#'): continue
            name=line.split('{',1)[0]
            if 'mountpoint="/data"' in line:
                values[name]=float(line.rsplit(' ',1)[1])
            if line.startswith('pg_wal_size_mb{'): values['wal']=float(line.rsplit(' ',1)[1])*MIB
            if line.startswith('pg_database_size_bytes{') and 'datname="postgres"' in line:
                values['database_bytes']=float(line.rsplit(' ',1)[1])
        require(values.get('node_filesystem_readonly')==0,'Database filesystem read-only/unavailable')
        require('node_filesystem_avail_bytes' in values and 'wal' in values and 'database_bytes' in values,'Required storage metrics missing')
        return {'available':int(values['node_filesystem_avail_bytes']),'time':served,
                'wal_bytes':int(values['wal']),'database_bytes':int(values['database_bytes']),
                'source':'Supabase Metrics API /data'}


class Budget:
    def __init__(self, metrics, reserve=RESERVE):
        self.metrics,self.reserve=metrics,reserve
        self.history=[]

    def check(self, health, rows):
        now=time.time()
        self.history.append((now,lsn(health['wal_lsn']),int(health['database_bytes'])))
        sample=self.metrics.sample()
        if abs(now-sample['time'])>90:
            raise StorageStop('Stale filesystem sample')
        if sample['available']<self.reserve:
            raise StorageStop('Available physical disk below 256 MiB reserve')
        # Allow up to 90 s backend caching. Debit all WAL/database growth since
        # a sample at least that old; until then debit from the first observation.
        older=[x for x in self.history if x[0]<=sample['time']-90]
        anchor=older[-1] if older else self.history[0]
        wal_debit=max(0,lsn(health['wal_lsn'])-anchor[1])
        db_debit=max(0,int(health['database_bytes'])-anchor[2])
        effective=sample['available']-wal_debit-db_debit
        allowance=rows*(8192+256)+64*MIB if rows else 0
        require(rows<=10500,'Unreviewed batch size')
        if effective-allowance<self.reserve:
            raise StorageStop('Insufficient conservative next-batch headroom; no further writes')
        if 'wal_bytes' in sample and abs(sample['wal_bytes']-int(health['wal_bytes']))>32*MIB:
            raise StorageStop('WAL metrics lag live SQL by more than 32 MiB; stop for fresh readings')
        if 'database_bytes' in sample and int(health['database_bytes'])-sample['database_bytes']>16*MIB:
            raise StorageStop('Database-size metrics lag live SQL by more than 16 MiB')
        return {**sample,'effective_available':effective,'wal_debit':wal_debit,'database_debit':db_debit,
                'next_batch_allowance':allowance,'reserve':self.reserve}


def connect(manifest, target, write=False):
    base=Path.home()/'.local/share/111sports-recovery'
    if target=='local':
        for name in ('PGSERVICE','PGSERVICEFILE','PGHOSTADDR','PGPASSWORD','PGPASSFILE','PGOPTIONS'):
            os.environ.pop(name,None)
        conn=psycopg.connect(host=str(base/'rehearsal17/socket'),hostaddr='',port=55447,
          user='nba_recovery',dbname='postgres',password='',passfile=str(base/'rehearsal17/local-password-unused'),
          sslmode='disable',connect_timeout=5,prepare_threshold=None,row_factory=dict_row)
    else:
        import configparser
        path=manifest.base/'service.conf'
        require(path.stat().st_mode & 0o077 == 0,'Archive service permissions unsafe')
        config=configparser.ConfigParser(interpolation=None);config.read(path)
        service=config['111sports-production']
        require(service['user']==f'postgres.{PROJECT}' and service['dbname']=='postgres' and service['port']=='5432'
          and service['host'].endswith('.pooler.supabase.com'),'Production service identity differs')
        os.environ['PGSERVICEFILE']=str(path)
        conn=psycopg.connect('service=111sports-production',connect_timeout=10,
          application_name='111sports-nba-cleanup-runner',prepare_threshold=None,row_factory=dict_row)
    # Property is set BEFORE the first SQL. No dry-run read-write transaction.
    conn.read_only=True
    with conn.transaction():
        require(conn.execute("SELECT current_setting('transaction_read_only') AS mode").fetchone()['mode']=='on','Read-only connection not established')
        conn.execute("SET SESSION timezone='UTC'")
        conn.execute("SET SESSION statement_timeout='30s'")
        conn.execute("SET SESSION idle_in_transaction_session_timeout='30s'")
        conn.execute('SET SESSION default_transaction_read_only='+('off' if write else 'on'))
        if target=='local':
            info=conn.execute("SELECT inet_server_addr() AS addr,current_user AS role,current_setting('data_directory') AS path").fetchone()
            require(info['addr'] is None and info['role']=='nba_recovery' and str(base/'rehearsal17/data')==info['path'],'Local execution target is not the isolated cluster')
    conn.autocommit=True
    conn.read_only=not write
    return Database(conn,manifest,local=target=='local')


def authorize(path, manifest):
    require(path is not None,'Production execution is not authorized: approval file required before connecting')
    require(Path(path).stat().st_mode & 0o077 == 0,'Authorization file must be private (mode 600)')
    value=loads(Path(path).read_text())
    require(value.get('authorization')==AUTH_TOKEN,'Explicit production authorization absent')
    require(value.get('runner_sha256')==package_digest() and value.get('manifest_sha256')==manifest.source_sha
        and value.get('cache_sha256')==manifest.cache_sha,'Authorization is not bound to reviewed code/manifest')
    require(value.get('current_checksum')==manifest.metadata['current_checksum'] and value.get('cutoff')==CUTOFF,'Authorization scope mismatch')
    expiry=datetime.fromisoformat(value['expires_at']).timestamp()
    require(time.time()<expiry<=time.time()+24*3600,'Authorization expired or longer than 24h')


def execute_run(db, budget, ledger, max_transactions=0, hook=None):
    started=time.monotonic()
    audit=db.audit(classify=True)
    pending=audit.pop('pending_keys')
    ledger.emit('initial_audit',**audit,pending_keys=len(pending))
    if not pending:
        require(audit['history_count']==db.manifest.metadata['expected_retained'],'No pending keys but final count differs')
        return {'status':'COMPLETE','transactions':0,'deleted_this_run':0,
                'already_deleted_at_start':audit['already_deleted'],'final':audit,
                'physical_compaction_performed':False,'elapsed_seconds':round(time.monotonic()-started,2),
                'max_transaction_seconds':0,'wal_generated_bytes':0}
    db.setup()
    live_count=audit['history_count']; already=audit['already_deleted']
    deleted=transactions=since_full=0
    max_duration=0
    while pending:
        numbers=pending[:250]
        keys=db.manifest.keys(numbers)
        rows=sum(len(k['versions'])-2 for k in keys)
        health=db.health()
        storage=budget.check(health,rows)
        ledger.emit('batch_preflight',keys=len(keys),candidates=rows,storage=storage,wal_lsn=health['wal_lsn'])
        result=db.apply(keys,hook=hook)
        max_duration=max(max_duration,result['seconds'])
        # A missing ledger write never authorizes a retry: startup reclassifies DB IDs.
        deleted+=result['deleted'];live_count-=result['deleted'];since_full+=result['deleted'];transactions+=1
        pending=pending[len(keys):]
        after=db.health()
        result['wal_generated']=lsn(after['wal_lsn'])-lsn(health['wal_lsn'])
        ledger.emit('committed',**result,run_deleted=deleted,expected_history=live_count,wal_bytes=after['wal_bytes'])
        require(result['seconds']<=25,'Committed transaction exceeded duration budget; stop before another batch')
        budget.check(after,0)
        if since_full>=100000 or not pending:
            checked=db.audit(expected_count=live_count)
            checked.pop('pending_keys')
            ledger.emit('full_integrity_verified',**checked)
            since_full=0
        if max_transactions and transactions>=max_transactions and pending:
            return {'status':'PAUSED_AT_REQUESTED_LIMIT','transactions':transactions,'deleted_this_run':deleted,
                    'already_deleted_at_start':already,'remaining_candidates':live_count-db.manifest.metadata['expected_retained'],
                    'elapsed_seconds':round(time.monotonic()-started,2),'max_transaction_seconds':max_duration}
    final=db.audit(expected_count=db.manifest.metadata['expected_retained'])
    final.pop('pending_keys')
    return {'status':'COMPLETE','transactions':transactions,'deleted_this_run':deleted,
            'already_deleted_at_start':already,'final':final,'physical_compaction_performed':False,
            'elapsed_seconds':round(time.monotonic()-started,2),'max_transaction_seconds':max_duration,
            'wal_generated_bytes':lsn(final['health']['wal_lsn'])-lsn(audit['health']['wal_lsn'])}


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=['dry-run','local-execute','production-execute'])
    parser.add_argument('--archive',type=Path,default=Path.home()/'.local/share/111sports-recovery/archive-20261027')
    parser.add_argument('--target',choices=['local','production'],default='production')
    parser.add_argument('--authorization-file',type=Path)
    parser.add_argument('--max-transactions',type=int,default=0)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    require(not args.report.exists(),'Existing report preserved; choose a new path')
    if args.mode=='local-execute': require(args.target=='local','Local execution cannot target production')
    if args.mode=='production-execute': require(args.target=='production','Wrong production execution target')
    manifest=Manifest(args.archive)
    if args.mode=='production-execute': authorize(args.authorization_file,manifest)
    lock=(args.archive/f'runner-process-{args.target}.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    ledger=Ledger(args.report.with_suffix('.jsonl'))
    db=None
    def interrupted(signum,frame): raise KeyboardInterrupt('Operator interrupted runner')
    signal.signal(signal.SIGINT,interrupted);signal.signal(signal.SIGTERM,interrupted)
    report={'mode':args.mode,'target':args.target,'runner_sha256':package_digest(),
            'manifest_sha256':manifest.source_sha,'cache_sha256':manifest.cache_sha,
            'production_write_authorized':args.mode=='production-execute'}
    try:
        db=connect(manifest,args.target,write=args.mode!='dry-run')
        metrics=Metrics(manifest.base if args.target=='local' else None)
        budget=Budget(metrics)
        if args.mode=='dry-run':
            audit=db.audit(classify=True)
            pending=audit.pop('pending_keys')
            keys=manifest.keys(pending[:250]) if pending else []
            rows=sum(len(k['versions'])-2 for k in keys)
            storage=budget.check(db.health(),rows)
            report.update(status='READY_FOR_REVIEW',audit=audit,pending_keys=len(pending),
                remaining_candidates=audit['history_count']-manifest.metadata['expected_retained'],
                next_batch_candidates=rows,storage=storage,transactions_read_only=True,
                production_writes_performed=False,temporary_tables_created=False)
        else:
            report.update(execute_run(db,budget,ledger,args.max_transactions))
    except BaseException as error:
        report.update(status='STOPPED',error_type=type(error).__name__,error=str(error),
                      resume_requires_database_reconciliation=True,last_confirmed_commit=ledger.last_commit)
    finally:
        if db is not None: db.conn.close()
        args.report.write_text(json.dumps(report,default=str,indent=2))
        ledger.emit('run_finished',status=report['status'],report=str(args.report))
    if report['status'] not in ('READY_FOR_REVIEW','COMPLETE','PAUSED_AT_REQUESTED_LIMIT'): raise SystemExit(1)


if __name__=='__main__':
    main()
