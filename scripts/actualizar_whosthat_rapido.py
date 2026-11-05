#!/usr/bin/env python3
import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import re
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
SOURCE = 'https://planet.openstreetmap.org/replication/hour'
AGENT = 'IDsChangesetsByUser/1.0 (+https://github.com/atarom/IDsChangesetsByUser)'
STATE_RE = re.compile(rb'(?m)^sequenceNumber=(\d+)\s*$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
UPSERT = '''
INSERT INTO whosthat (user_id, user_name, date_first, date_last)
VALUES (?, ?, ?, ?)
ON CONFLICT(user_id, user_name) DO UPDATE SET
  date_first = min(whosthat.date_first, excluded.date_first),
  date_last  = max(whosthat.date_last,  excluded.date_last)
'''
def request(url, dest=None, attempts=4):
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': AGENT})
            with urllib.request.urlopen(req, timeout=70) as response:
                if dest is None:
                    return response.read()
                with open(dest, 'wb') as f:
                    shutil.copyfileobj(response, f, 1024 * 1024)
                return
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            if attempt == attempts - 1:
                raise RuntimeError(f'No se pudo descargar {url}: {exc}') from exc
            print(f'  Error de red ({exc}); reintento {attempt + 2}/{attempts}...', file=sys.stderr, flush=True)
            time.sleep(min(2 ** (attempt + 1), 12))
def remote_state(source):
    content = request(source.rstrip('/') + '/state.txt')
    m = STATE_RE.search(content)
    if not m:
        raise ValueError('El estado remoto no contiene sequenceNumber válido')
    return int(m.group(1))
def diff_url(source, seq):
    num = f'{seq:09d}'
    return f'{source.rstrip("/")}/{num[:3]}/{num[3:6]}/{num[6:9]}.osc.gz'
def extract_users(gz_path):
    users = {}
    with gzip.open(gz_path, 'rb') as raw:
        for _event, elem in ET.iterparse(raw, events=('end',)):
            attrs = elem.attrib
            uid, name = attrs.get('uid'), attrs.get('user')
            date = attrs.get('timestamp') or attrs.get('created_at')
            if uid and name and date:
                if not uid.isdigit() or not DATE_RE.fullmatch(date[:10]):
                    raise ValueError(f'UID/fecha incorrectos en diff: {uid!r}, {date!r}')
                d = date[:10]
                key = (int(uid), name)
                if key in users:
                    first, last = users[key]
                    users[key] = (min(first, d), max(last, d))
                else:
                    users[key] = (d, d)
            elem.clear()
    return [(uid, name, first, last) for (uid, name), (first, last) in users.items()]
def db_sequence(con):
    item = con.execute("SELECT value FROM metadata WHERE key = 'sequenceNumber'").fetchone()
    if not item or not item[0].isdigit():
        raise ValueError('Falta sequenceNumber válido en metadata de SQLite; verifica la base de datos de origen')
    return int(item[0])
def apply_diff(con, seq, rows):
    con.execute('BEGIN IMMEDIATE')
    try:
        existing = db_sequence(con)
        if existing != seq - 1:
            raise ValueError(f'Secuencia inesperada: se esperaba {seq-1}, hay {existing}')
        con.executemany(UPSERT, rows)
        con.execute("UPDATE metadata SET value=? WHERE key='sequenceNumber'", (str(seq),))
        con.commit()
    except Exception:
        con.rollback()
        raise
def fetch_and_parse(source, seq):
    with tempfile.TemporaryDirectory(prefix='whosthat-osc-') as td:
        tmp = Path(td) / f'{seq}.osc.gz'
        request(diff_url(source, seq), tmp)
        return extract_users(tmp)
def run(db, source, max_files, status_only, workers):
    if not db.is_file():
        raise FileNotFoundError(f'No existe la base de datos: {db}')
    con = sqlite3.connect(db, timeout=30, isolation_level=None)
    try:
        con.execute('PRAGMA busy_timeout=30000')
        con.execute('PRAGMA journal_mode=DELETE')
        con.execute('PRAGMA foreign_keys=ON')
        current = db_sequence(con)
        print(f'Estado local: {current}', flush=True)
        if status_only:
            return
        latest = remote_state(source)
        print(f'Estado remoto: {latest}', flush=True)
        if current > latest:
            raise ValueError('La secuencia local es superior a la remota: comprueba la fuente')
        if current == latest:
            print('Ya está al día.', flush=True)
            return
        end = min(latest, current + max_files) if max_files is not None else latest
        print(f'Procesando secuencias {current + 1}–{end}. Puedes interrumpir y reanudar.', flush=True)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            tasks = {}
            next_submit = current + 1
            for seq in range(current + 1, end + 1):
                while next_submit <= end and next_submit < seq + 2 * workers:
                    tasks[next_submit] = pool.submit(fetch_and_parse, source, next_submit)
                    next_submit += 1
                rows = tasks.pop(seq).result()
                apply_diff(con, seq, rows)
                print(f'{seq}/{latest}: {len(rows)} pares usuario/nombre procesados. Guardado.', flush=True)
        if end < latest:
            print(f'Pausa en {end}. Faltan {latest - end} diffs al estado remoto consultado. Repite el comando.', flush=True)
        else:
            print(f'¡Sincronización terminada hasta {end}!', flush=True)
    finally:
        con.close()
if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Actualizar una base SQLite local de Who\'s That? con OSM')
    p.add_argument('--db', type=Path, default=Path(__file__).with_name('whosthat.sqlite'))
    p.add_argument('--source', default=SOURCE, help='URL base de la replicación HORARIA de OSM')
    mode = p.add_mutually_exclusive_group()
    mode.add_argument('--max-files', type=int, default=48, help='Máximo de diffs por ejecución (por defecto 48)')
    mode.add_argument('--all', action='store_true', help='Procesar todo el retraso en una ejecución')
    p.add_argument('--status', action='store_true', help='Mostrar la secuencia local sin acceder a Internet')
    p.add_argument('--workers', type=int, default=4, help='Descargas simultáneas (1 a 8, por defecto 4)')
    args = p.parse_args()
    try:
        if args.max_files is not None and args.max_files < 1:
            p.error('--max-files debe ser al menos 1')
        if not 1 <= args.workers <= 8:
            p.error('--workers debe estar entre 1 y 8')
        run(args.db, args.source, None if args.all else args.max_files, args.status, args.workers)
    except KeyboardInterrupt:
        print('\nInterrumpido. Los diffs ya confirmados permanecen guardados.', file=sys.stderr)
        sys.exit(130)
    except Exception as exc:
        print(f'ERROR: {exc}\nLa secuencia se mantiene en el último diff procesado correctamente.', file=sys.stderr)
        sys.exit(1)
