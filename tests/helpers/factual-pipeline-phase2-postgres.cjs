/* eslint-disable @typescript-eslint/no-require-imports */
// Only a NEW disposable Unix-socket cluster. Never reads .env or accepts DB URLs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;

function isolatedPostgres(bin) {
  if (!path.isAbsolute(bin)) throw new Error('Explicit absolute PostgreSQL binary directory required');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '111-factual-phase2-'));
  fs.chmodSync(dir, 0o700);
  const socket = path.join(dir, 'socket'); fs.mkdirSync(socket, { mode: 0o700 });
  const passfile = path.join(dir, 'empty.pgpass'); fs.writeFileSync(passfile, '', { mode: 0o600 });
  // Allowlist: no inherited DATABASE_URL, Supabase credentials, PG service/config,
  // .pgpass, node preload, or externally selected host is passed to subprocesses.
  const env = { PATH: '/usr/bin:/bin', LANG: 'C', PGSSLMODE: 'disable', PGPASSFILE: passfile,
    LD_LIBRARY_PATH: path.resolve(bin, '../../../x86_64-linux-gnu') };
  const run = (name, args, input) => execFileSync(path.join(bin, name), args,
    { env, input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  const version = run('postgres', ['--version']).trim();
  const major = version.match(/PostgreSQL\) (\d+)/)[1];
  const args = () => ['-X', '-h', socket, '-p', '55452', '-U', 'phase2_fixture', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-f', '-'];
  const sql = input => run('psql', args(), `set statement_timeout='15s';\n${input}`).trim();
  const asyncSql = input => new Promise((resolve, reject) => {
    const child = execFile(path.join(bin, 'psql'), args(), { env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => error ? reject(Object.assign(error, { stderr })) : resolve(stdout.trim()));
    child.stdin.end(`set statement_timeout='15s';\n${input}`);
  });
  const close = () => {
    try { if (fs.existsSync(path.join(dir, 'data/postmaster.pid'))) run('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', '-w', 'stop']); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  try {
    run('initdb', ['-D', path.join(dir, 'data'), '-L', path.resolve(bin, '../../../../share/postgresql', major),
      '--auth=trust', '--username=phase2_fixture', '--no-locale', '--encoding=UTF8']);
    run('pg_ctl', ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'postgres.log'), '-o',
      `-k ${socket} -p 55452 -c listen_addresses='' -c jit=off -c max_connections=20`, '-w', 'start']);
    const actual = JSON.parse(sql("select json_build_object('data',current_setting('data_directory'),'tcp',inet_server_addr(),'listen',current_setting('listen_addresses'))"));
    if (actual.data !== path.join(dir, 'data') || actual.tcp !== null || actual.listen !== '') throw new Error('Isolation verification failed');
    return { sql, asyncSql, close, version, environment: { transport: 'private Unix socket', tcp: false, fixtureOnly: true, sanitizedRestore: false } };
  } catch (error) { close(); throw error; }
}

module.exports = { isolatedPostgres, quote, json };
