#!/usr/bin/env python3
"""Actualiza, verifica y republica los cambios horarios en un archivo cifrado.
No sustituye el archivo cifrado si falla una descarga o integridad.
"""
import argparse
from pathlib import Path
import getpass
import os
import sqlite3
import sys
import tempfile

from crypto_db import decrypt_database, encrypt_database
from actualizar_whosthat_rapido import run, SOURCE


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
    with tempfile.TemporaryDirectory(prefix='whosthat-update-') as td:
        sqlite_file = Path(td) / 'whosthat.sqlite'
        print('Descifrando a una copia temporal...', flush=True)
        decrypt_database(args.encrypted, sqlite_file, password)
        print('Actualizando diffs horarios...', flush=True)
        run(sqlite_file, args.source, args.max_files, False, args.workers)
        con = sqlite3.connect(sqlite_file)
        try:
            integrity = con.execute('PRAGMA integrity_check').fetchone()[0]
            if integrity != 'ok':
                raise RuntimeError(f'Integridad SQLite fallida: {integrity}')
        finally:
            con.close()
        print('Comprimiendo y cifrando...', flush=True)
        meta = encrypt_database(sqlite_file, args.encrypted, password, version_path=args.version)
        print(f"Actualización publicada, secuencia {meta['sequenceNumber']}; {meta['records']} registros.")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('ERROR:', e, file=sys.stderr)
        sys.exit(1)
