#!/usr/bin/env python3
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
from optimizar_sqlite import optimize_if_needed
def main():
    p = argparse.ArgumentParser(description='Actualizar base cifrada Who\'s That?')
    p.add_argument('--encrypted', type=Path, default=Path(__file__).parent.parent / 'data' / 'whosthat.db.gz.enc')
    p.add_argument('--version', type=Path, default=Path(__file__).parent.parent / 'data' / 'version.json')
    p.add_argument('--max-files', type=int, default=None, help='Límite de diffs horarios; sin límite por defecto')
    p.add_argument('--workers', type=int, default=4)
    p.add_argument('--source', default=SOURCE)
    args = p.parse_args()
    if not 1 <= args.workers <= 8:
        p.error('workers debe estar entre 1 y 8')
    password = os.environ.get('WHOSTHAT_DB_PASSWORD') or getpass.getpass('Contraseña de la base: ')
    started = time.perf_counter()
    timings = {}
    with tempfile.TemporaryDirectory(prefix='whosthat-update-') as td:
        sqlite_file = Path(td) / 'whosthat.sqlite'
        print('Descifrando a una copia temporal...', flush=True)
        stage = time.perf_counter()
        decrypt_database(args.encrypted, sqlite_file, password)
        timings['Descifrado'] = time.perf_counter() - stage
        print('Actualizando diffs horarios...', flush=True)
        stage = time.perf_counter()
        run(sqlite_file, args.source, args.max_files, False, args.workers)
        timings['Actualización de diffs'] = time.perf_counter() - stage
        stage = time.perf_counter()
        con = sqlite3.connect(sqlite_file)
        try:
            integrity = con.execute('PRAGMA integrity_check').fetchone()[0]
            if integrity != 'ok':
                raise RuntimeError(f'Integridad SQLite fallida: {integrity}')
        finally:
            con.close()
        timings['Integridad SQLite'] = time.perf_counter() - stage
        stage = time.perf_counter()
        compact = optimize_if_needed(sqlite_file, Path(td) / 'whosthat-compact.sqlite')
        timings['Optimización'] = time.perf_counter() - stage
        print('Comprimiendo y cifrando...', flush=True)
        stage = time.perf_counter()
        meta = encrypt_database(compact, args.encrypted, password, version_path=args.version)
        timings['Compresión y cifrado'] = time.perf_counter() - stage
        print(f"Actualización publicada, secuencia {meta['sequenceNumber']}; {meta['records']} registros.", flush=True)
        print('TIEMPOS ETAPAS: ' + ' | '.join(f'{name} {seconds:.2f} s' for name, seconds in timings.items()), flush=True)
        print(f'TIEMPO TOTAL PREPARACIÓN: {time.perf_counter() - started:.2f} s (sin subida a GitHub).', flush=True)
if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('ERROR:', e, file=sys.stderr)
        sys.exit(1)
