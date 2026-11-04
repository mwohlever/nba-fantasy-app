"""All mutations are confined to a disposable DB on the private local socket."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
import cleanup_runner as r

HERE=Path(__file__).resolve().parent
SOCKET=Path.home()/'.local/share/111sports-recovery/rehearsal17/socket'
NAME='nba_runner_test_'+str(os.getpid())


def local(db='postgres'):
    for name in ('PGSERVICE','PGSERVICEFILE','PGHOSTADDR','PGPASSWORD','PGPASSFILE','PGOPTIONS'):
        os.environ.pop(name,None)
    conn=psycopg.connect(host=str(SOCKET),hostaddr='',port=55447,user='nba_recovery',dbname=db,
        sslmode='disable',password='',passfile=str(SOCKET.parent/'local-password-unused'),row_factory=dict_row,autocommit=True)
    identity=conn.execute("SELECT inet_server_addr() AS addr,current_user AS role,current_setting('data_directory') AS path").fetchone()
    assert identity['addr'] is None and identity['role']=='nba_recovery'
    assert identity['path']==str(Path.home()/'.local/share/111sports-recovery/rehearsal17/data')
    return conn


class FakeMetrics:
    def __init__(self,available=20*1024**3,old=False): self.available,self.old=available,old
    def sample(self): return {'available':self.available,'time':time.time()-(120 if self.old else 0),'source':'test'}


class RunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with local() as conn: conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(NAME)))
        for filename in ['20260925000100_nba_projection_observation_foundation.sql',
                         '20260925000200_nba_current_observations.sql',
                         '20261027000100_nba_observation_semantic_append.sql']:
            if filename.startswith('202609250001'):
                with local(NAME) as conn:
                    conn.execute('CREATE TABLE players(id bigint PRIMARY KEY); INSERT INTO players VALUES(7)')
            subprocess.run(['bash',str(HERE/'native-cluster.sh'),'psql','--dbname='+NAME,
                '--file='+str(HERE.parents[2]/'migrations'/filename)],check=True,stdout=subprocess.DEVNULL)

    @classmethod
    def tearDownClass(cls):
        with local() as conn: conn.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(NAME)))

    def setUp(self):
        self.conn=local(NAME)
        self.conn.execute('TRUNCATE nba_player_game_current_observations,nba_player_game_observation_versions RESTART IDENTITY')
        self.conn.execute('''INSERT INTO nba_player_game_observation_versions(
          provider,provider_player_id,provider_event_id,local_player_id,season,phase,game_at,
          minutes,points,rebounds,assists,steals,blocks,turnovers,source_url,
          provider_fetched_at,provider_known_at,normalization_version,observation_hash)
          SELECT 'espn','42','40100'||event,7,2026,'regular','2026-01-01T00:00Z',
            30,10,2,1,0,0,1,'https://example.test',
            '2026-09-01T00:00Z'::timestamptz+day*interval '1 day',
            '2026-09-01T00:00Z'::timestamptz+day*interval '1 day','v1',
            md5(event||':'||day)||md5(event||':'||day)
          FROM generate_series(1,3) event CROSS JOIN generate_series(0,43) day ORDER BY event,day''')
        self.temp=tempfile.TemporaryDirectory(prefix='nba-runner-unit-')
        self.base=Path(self.temp.name)
        metadata_sql=(HERE/'capture-metadata.sql').read_text()
        value=subprocess.check_output(['bash',str(HERE/'native-cluster.sh'),'psql','-Atq',
            '--dbname='+NAME,'--file=-'],input=metadata_sql,text=True)
        m=json.loads(value)
        m.update(expected_versions=132,expected_current=3,expected_retained=6,expected_candidates=126)
        (self.base/'metadata.json').write_text(json.dumps(m))
        manifest=subprocess.check_output(['bash',str(HERE/'native-cluster.sh'),'psql','-Atq',
            '--dbname='+NAME,'--file='+str(HERE/'manifest-local.sql')],text=True)
        (self.base/'manifest.jsonl').write_text(manifest)
        (self.base/'review-batches').mkdir()
        (self.base/'review-batches/READY.json').write_text(json.dumps({'manifest_sha256':r.digest(self.base/'manifest.jsonl')}))
        names=['observations.dump','public-schema.sql','archive.contents']
        for name in names: (self.base/name).write_text('local fixture only')
        names.append('metadata.json')
        (self.base/'archive.sha256').write_text(''.join(f'{r.digest(self.base/name)}  {name}\n' for name in names))
        self.manifest=r.Manifest(self.base,strict=False)
        self.db=r.Database(self.conn,self.manifest,local=True)

    def tearDown(self):
        self.conn.close()
        self.manifest.db.close()
        self.temp.cleanup()

    def count(self): return self.conn.execute('SELECT count(*) AS n FROM nba_player_game_observation_versions').fetchone()['n']
    def enabled(self):
        return self.conn.execute("SELECT tgenabled FROM pg_trigger WHERE tgrelid='nba_player_game_observation_versions'::regclass AND tgname='nba_observation_versions_immutable'").fetchone()['tgenabled']

    def test_cleanup_resume_and_final_integrity(self):
        before=self.db.audit(classify=True)
        self.assertEqual(before['history_count'],132)
        self.db.setup()
        self.assertEqual(self.db.apply(self.manifest.keys([1]))['deleted'],42)
        self.assertEqual(self.count(),90)
        self.conn.close();self.conn=local(NAME);self.db=r.Database(self.conn,self.manifest,local=True)
        state=self.db.audit(classify=True)
        self.assertEqual(state['already_deleted'],42)
        self.assertEqual(state['pending_keys'],[2,3])
        log=r.Ledger(self.base/'resume.jsonl')
        result=r.execute_run(self.db,r.Budget(FakeMetrics()),log)
        self.assertEqual(result['status'],'COMPLETE')
        self.assertEqual(result['deleted_this_run'],84)
        self.assertEqual(result['final']['history_count'],6)
        self.assertEqual(self.enabled(),'O')
        log.file.close()

    def test_interrupt_during_delete_rolls_back(self):
        self.db.setup()
        def hook(stage):
            if stage=='deleted': raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt): self.db.apply(self.manifest.keys([1]),hook=hook)
        self.assertEqual(self.count(),132);self.assertEqual(self.enabled(),'O')

    def test_error_after_delete_rolls_back(self):
        self.db.setup()
        def hook(stage):
            if stage=='deleted': raise RuntimeError('Injected failure')
        with self.assertRaises(RuntimeError): self.db.apply(self.manifest.keys([1]),hook=hook)
        self.assertEqual(self.count(),132);self.assertEqual(self.enabled(),'O')

    def test_lost_commit_ack_is_reconciled(self):
        self.db.setup()
        def hook(stage):
            if stage=='committed': raise ConnectionError('Injected lost acknowledgement')
        with self.assertRaises(ConnectionError): self.db.apply(self.manifest.keys([1]),hook=hook)
        self.assertEqual(self.count(),90)
        self.assertEqual(self.db.audit(classify=True)['already_deleted'],42)
        self.assertEqual(self.enabled(),'O')

    def test_changed_stat_aborts_before_deleting(self):
        self.conn.execute('ALTER TABLE nba_player_game_observation_versions DISABLE TRIGGER nba_observation_versions_immutable')
        self.conn.execute('UPDATE nba_player_game_observation_versions SET points=999 WHERE id=2')
        self.conn.execute('ALTER TABLE nba_player_game_observation_versions ENABLE TRIGGER nba_observation_versions_immutable')
        self.db.setup()
        with self.assertRaises(r.Stop): self.db.apply(self.manifest.keys([1]))
        self.assertEqual(self.count(),132);self.assertEqual(self.enabled(),'O')

    def test_missing_boundary_and_partial_history_stop(self):
        self.conn.execute('ALTER TABLE nba_player_game_observation_versions DISABLE TRIGGER nba_observation_versions_immutable')
        self.conn.execute('DELETE FROM nba_player_game_observation_versions WHERE id=1')
        self.conn.execute('ALTER TABLE nba_player_game_observation_versions ENABLE TRIGGER nba_observation_versions_immutable')
        with self.assertRaises(r.Stop): self.db.audit(classify=True)
        self.assertEqual(self.count(),131);self.assertEqual(self.enabled(),'O')

    def test_changed_current_stops(self):
        self.conn.execute("UPDATE nba_player_game_current_observations SET points=999 WHERE provider_event_id='401001'")
        self.db.setup()
        with self.assertRaises(r.Stop): self.db.apply(self.manifest.keys([1]))
        self.assertEqual(self.count(),132);self.assertEqual(self.enabled(),'O')

    def test_storage_and_stale_metrics_stop_before_delete(self):
        health=self.db.health()
        with self.assertRaises(r.StorageStop): r.Budget(FakeMetrics(r.RESERVE-1)).check(health,42)
        with self.assertRaises(r.StorageStop): r.Budget(FakeMetrics(r.RESERVE+10*r.MIB)).check(health,42)
        with self.assertRaises(r.StorageStop): r.Budget(FakeMetrics(old=True)).check(health,42)
        self.assertEqual(self.count(),132);self.assertEqual(self.enabled(),'O')

    def test_unexpected_count_and_production_authorization_guard(self):
        with self.assertRaises(r.Stop): self.db.audit(expected_count=131)
        with self.assertRaises(r.Stop): r.authorize(None,self.manifest)
        path=self.base/'bad-authorization.json';path.write_text('{}')
        with self.assertRaises(r.Stop): r.authorize(path,self.manifest)
        self.assertEqual(self.count(),132)

    def test_deadline_stops_before_mutation(self):
        self.db.setup()
        with self.assertRaises(r.Stop): self.db.apply(self.manifest.keys([1]),max_seconds=0)
        self.assertEqual(self.count(),132);self.assertEqual(self.enabled(),'O')

    def test_postcheck_failure_restores_deleted_rows_and_trigger(self):
        self.db.setup()
        def hook(stage):
            if stage=='deleted': self.conn.execute('DELETE FROM nba_player_game_observation_versions WHERE id=1')
        with self.assertRaises(r.Stop): self.db.apply(self.manifest.keys([1]),hook=hook)
        self.assertEqual(self.count(),132);self.assertEqual(self.enabled(),'O')

    def test_disabled_trigger_stops_without_reenabling_it(self):
        self.conn.execute('ALTER TABLE nba_player_game_observation_versions DISABLE TRIGGER nba_observation_versions_immutable')
        try:
            with self.assertRaises(r.Stop): self.db.health()
            self.assertEqual(self.enabled(),'D')
        finally:
            self.conn.execute('ALTER TABLE nba_player_game_observation_versions ENABLE TRIGGER nba_observation_versions_immutable')

    def test_metrics_failure_stops(self):
        class BrokenMetrics:
            def sample(self): raise OSError('Injected metrics outage')
        with self.assertRaises(OSError): r.Budget(BrokenMetrics()).check(self.db.health(),42)
        self.assertEqual(self.count(),132)

    def test_readonly_factory_cannot_create_staging(self):
        readonly=r.connect(self.manifest,'local',write=False)
        try:
            with readonly.read() as cur:
                self.assertEqual(cur.execute("SELECT current_setting('transaction_read_only') AS mode").fetchone()['mode'],'on')
                self.assertEqual(cur.execute('SELECT pg_my_temp_schema() AS n').fetchone()['n'],0)
            with self.assertRaises(psycopg.errors.ReadOnlySqlTransaction):
                readonly.conn.execute('CREATE TEMP TABLE runner_must_not_create(id integer)')
        finally:
            readonly.conn.close()

    def test_production_mode_checks_authorization_before_connecting(self):
        with patch.object(r,'Manifest',return_value=self.manifest),patch.object(r,'connect') as connection:
            with patch('sys.argv',['runner','production-execute','--report',str(self.base/'denied.json')]):
                with self.assertRaises(r.Stop): r.main()
            connection.assert_not_called()

    def test_completed_run_does_not_create_staging_or_delete_again(self):
        self.db.setup();self.db.apply(self.manifest.keys())
        self.conn.close();self.conn=local(NAME);self.db=r.Database(self.conn,self.manifest,local=True)
        log=r.Ledger(self.base/'complete-again.jsonl')
        try:
            with (patch.object(self.db,'setup',side_effect=AssertionError('Must not stage')),
                  patch.object(self.db,'apply',side_effect=AssertionError('Must not delete'))):
                result=r.execute_run(self.db,r.Budget(FakeMetrics()),log)
            self.assertEqual(result['status'],'COMPLETE')
            self.assertEqual(result['transactions'],0)
            self.assertEqual(result['deleted_this_run'],0)
            self.assertEqual(self.count(),6)
        finally:
            log.file.close()


if __name__=='__main__': unittest.main(verbosity=2)
