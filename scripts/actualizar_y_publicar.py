import argparse
from pathlib import Path
import getpass
import os
import sqlite3
import sys
import tempfile
import time
from crypto_db import decrypt_database, encrypt_database
from actualizar_whosthat_rapido import run, SOURCE
def compact_database(sqlite_file):
    before = sqlite_file.stat().st_size
    started = time.perf_counter()
    con = sqlite3.connect(sqlite_file, isolation_level=None)
    try:
        con.execute('VACUUM')
    finally:
        con.close()
    after = sqlite_file.stat().st_size
    print(f'VACUUM: {before / 1048576:.2f} → {after / 1048576:.2f} MiB; reducción {(before - after) / before * 100:.2f} %.', flush=True)
    return time.perf_counter() - started
def main():
    p = argparse.ArgumentParser(description='Actualizar base cifrada Who\'s That?')
    p.add_argument('--encrypted', type=Path, default=Path(__file__).parent.parent / 'data' / 'whosthat.db.zst.enc')
    p.add_argument('--version', type=Path, default=Path(__file__).parent.parent / 'data' / 'version.json')
    p.add_argument('--max-files', type=int, default=None, help='Límite de diffs horarios; sin límite por defecto')
    p.add_argument('--workers', type=int, default=4)
    p.add_argument('--source', default=SOURCE)
    args = p.parse_args()
    if not 1 <= args.workers <= 8:
        p.error('workers debe estar entre 1 y 8')
    if args.max_files is not None and args.max_files < 1:
        p.error('--max-files debe ser al menos 1')
    password = os.environ.get('WHOSTHAT_DB_PASSWORD') or getpass.getpass('Contraseña de la base: ')
    started = time.perf_counter()
    timings = {}
    with tempfile.TemporaryDirectory(prefix='whosthat-update-') as td:
        sqlite_file = Path(td) / 'whosthat.sqlite'
        print('Descifrando una copia temporal...', flush=True)
        stage = time.perf_counter()
        decrypt_database(args.encrypted, sqlite_file, password)
        timings['Descifrado'] = time.perf_counter() - stage
        print('Actualizando diffs horarios...', flush=True)
        stage = time.perf_counter()
        run(sqlite_file, args.source, args.max_files, False, args.workers)
        timings['Actualización de diffs'] = time.perf_counter() - stage
        print('Compactando SQLite con VACUUM...', flush=True)
        timings['VACUUM'] = compact_database(sqlite_file)
        print('Validando, comprimiendo y cifrando SQLite...', flush=True)
        stage = time.perf_counter()
        meta = encrypt_database(sqlite_file, args.encrypted, password, version_path=args.version)
        timings['Validación, compresión y cifrado'] = time.perf_counter() - stage
        print(f"Actualización preparada, secuencia {meta['sequenceNumber']}; {meta['records']} registros.", flush=True)
        print('TIEMPOS ETAPAS: ' + ' | '.join(f'{name} {seconds:.2f} s' for name, seconds in timings.items()), flush=True)
        print(f'TIEMPO TOTAL PREPARACIÓN: {time.perf_counter() - started:.2f} s (sin subida a GitHub).', flush=True)
if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('ERROR:', exc, file=sys.stderr)
        sys.exit(1)
