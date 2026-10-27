#!/usr/bin/env python3
"""Interactive LOCAL credential preparation only. Does not connect to Supabase."""
from getpass import getpass
import os
from pathlib import Path
import re

project = 'oororafwujfliscjasur'
directory = Path.home() / '.local/share/111sports-recovery/archive-20261027'
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(directory, 0o700)
service = directory / 'service.conf'
password_file = directory / 'pgpass'
if service.exists() or password_file.exists():
    raise SystemExit('Existing connection files preserved. Review them locally instead of overwriting.')
host = input('Supabase SESSION pooler host: ').strip()
if not re.fullmatch(r'[a-zA-Z0-9.-]+\.pooler\.supabase\.com', host):
    raise SystemExit('Use the Session pooler host from Supabase Connect.')
username = input(f'Database user [postgres.{project}]: ').strip() or f'postgres.{project}'
if username != f'postgres.{project}':
    raise SystemExit('User does not match the intended production project.')
password = getpass('Existing database password (hidden): ')
if not password or '\n' in password or '\r' in password:
    raise SystemExit('Empty/multiline password rejected.')
escape = lambda value: value.replace('\\', '\\\\').replace(':', '\\:')
with password_file.open('x') as output:
    os.chmod(password_file, 0o600)
    output.write(':'.join(map(escape, (host, '5432', 'postgres', username, password))) + '\n')
with service.open('x') as output:
    os.chmod(service, 0o600)
    output.write('[111sports-production]\n'
        f'host={host}\nport=5432\ndbname=postgres\nuser={username}\n'
        f'passfile={password_file}\nsslmode=require\nconnect_timeout=10\n'
        'application_name=111sports-observation-archive\n'
        'options=-c default_transaction_read_only=on -c statement_timeout=0 -c lock_timeout=5000\n')
print(f'Prepared private, read-only archive connection files in {directory}')
print('No database connection was made. Do not upload service.conf or pgpass to GitHub/chat.')
