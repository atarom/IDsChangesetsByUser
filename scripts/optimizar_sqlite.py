#!/usr/bin/env python3
from __future__ import annotations
import hashlib
import re
from pathlib import Path
import sqlite3
EXPECTED_COLUMNS = [
    ('user_id', 'INTEGER', 1, 1),
    ('user_name', 'TEXT', 1, 2),
    ('date_first', 'TEXT', 1, 0),
    ('date_last', 'TEXT', 1, 0),
]
ALLOWED_EXTRA_INDEXES = {
    'idx_name': 'CREATE INDEX idx_name ON whosthat(user_name COLLATE NOCASE)',
    'idx_last': 'CREATE INDEX idx_last ON whosthat(date_last)',
}
WHOSTHAT_DDL = '''
CREATE TABLE whosthat (
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    date_first TEXT NOT NULL,
    date_last TEXT NOT NULL,
    PRIMARY KEY(user_id, user_name)
) WITHOUT ROWID
'''
def _schema(con):
    objects = {}
    for typ, name, ddl in con.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex_%'"):
        objects[(typ, name)] = ddl
    tables = {name for (typ, name) in objects if typ == 'table'}
    if tables != {'whosthat', 'metadata'}:
        raise ValueError(f'Tablas inesperadas en la base: {tables}. No se convierte.')
    if any(typ not in {'table', 'index'} for typ, _ in objects):
        raise ValueError('Se encontraron vistas/disparadores u otros objetos; no se convierte.')
    info = [(row[1], row[2].upper(), row[3], row[5])
            for row in con.execute('PRAGMA table_info(whosthat)')]
    if info != EXPECTED_COLUMNS:
        raise ValueError('Estructura de columnas o clave primaria distinta; no se convierte.')
    mdinfo = [(row[1], row[2].upper(), row[3], row[5])
              for row in con.execute('PRAGMA table_info(metadata)')]
    if mdinfo != [('key', 'TEXT', 0, 1), ('value', 'TEXT', 1, 0)]:
        raise ValueError('Estructura de metadata inesperada; no se convierte.')
    ddl = objects[('table', 'whosthat')]
    compact = 'WITHOUT ROWID' in ddl.upper()
    idx = {name: text for (typ, name), text in objects.items() if typ == 'index'}
    for name, text in idx.items():
        if ALLOWED_EXTRA_INDEXES.get(name) != text:
            raise ValueError(f'Índice inesperado {name}; no se convierte.')
    if compact and not idx:
        return True, None
    if not re.search(r'PRIMARY\s+KEY\s*\(\s*user_id\s*,\s*user_name\s*\)', ddl, flags=re.IGNORECASE):
        raise ValueError('Clave primaria inesperada; no se convierte.')
    return False, objects[('table', 'metadata')]
def _hash_field(h, value):
    if value is None:
        h.update(b'N')
        return
    if isinstance(value, bytes):
        typ, buf = b'B', value
    elif isinstance(value, str):
        typ, buf = b'T', value.encode('utf-8', 'surrogatepass')
    elif isinstance(value, int):
        typ, buf = b'I', str(value).encode('ascii')
    else:
        typ, buf = b'F', repr(value).encode('ascii')
    h.update(typ)
    h.update(len(buf).to_bytes(8, 'big'))
    h.update(buf)
def logical_digest(db_file):
    h = hashlib.sha256()
    counts = []
    with sqlite3.connect(f'file:{Path(db_file).resolve()}?mode=ro', uri=True) as con:
        for table, columns, order in (
            ('whosthat', 'user_id,user_name,date_first,date_last', 'user_id,user_name COLLATE BINARY'),
            ('metadata', 'key,value', 'key COLLATE BINARY'),
        ):
            h.update(b'TABLE:' + table.encode('ascii'))
            count = 0
            for row in con.execute(f'SELECT {columns} FROM {table} ORDER BY {order}'):
                h.update(b'ROW')
                for value in row:
                    _hash_field(h, value)
                count += 1
            counts.append(count)
    return tuple(counts), h.hexdigest()
def optimize_if_needed(source: Path, destination: Path) -> Path:
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve():
        raise ValueError('El destino debe ser un archivo distinto del origen.')
    if destination.exists():
        raise FileExistsError(f'El destino ya existe: {destination}')
    with sqlite3.connect(f'file:{source.resolve()}?mode=ro', uri=True) as original:
        if original.execute('PRAGMA integrity_check').fetchone() != ('ok',):
            raise ValueError('La base origen no supera PRAGMA integrity_check.')
        compact, metadata_ddl = _schema(original)
        if compact:
            print('La base YA está optimizada (WITHOUT ROWID, sin índices auxiliares).', flush=True)
            return source
        user_version = original.execute('PRAGMA user_version').fetchone()[0]
        app_id = original.execute('PRAGMA application_id').fetchone()[0]
        initial_count = original.execute('SELECT count(*) FROM whosthat').fetchone()[0]
    print(f'Creando estructura optimizada para {initial_count:,} registros...', flush=True)
    try:
        with sqlite3.connect(destination) as con:
            con.execute('PRAGMA page_size=4096')
            con.execute('PRAGMA journal_mode=DELETE')
            con.execute('PRAGMA cache_size=-32768')
            con.execute(f'PRAGMA user_version={int(user_version)}')
            con.execute(f'PRAGMA application_id={int(app_id)}')
            con.execute('ATTACH DATABASE ? AS origen', (f'file:{source.resolve()}?mode=ro',))
            try:
                with con:
                    con.execute(metadata_ddl)
                    con.execute(WHOSTHAT_DDL)
                    con.execute('INSERT INTO metadata(key,value) SELECT key,value FROM origen.metadata')
                    con.execute('''INSERT INTO whosthat(user_id,user_name,date_first,date_last)
                                   SELECT user_id,user_name,date_first,date_last
                                   FROM origen.whosthat ORDER BY user_id,user_name''')
            finally:
                con.execute('DETACH DATABASE origen')
        with sqlite3.connect(f'file:{destination.resolve()}?mode=ro', uri=True) as check:
            if check.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                raise ValueError('La base optimizada no supera integrity_check.')
            is_compact, _ = _schema(check)
            if not is_compact:
                raise ValueError('La nueva base no tiene la estructura esperada.')
        original_hash = logical_digest(source)
        optimized_hash = logical_digest(destination)
        if original_hash != optimized_hash:
            raise ValueError('DATOS DISTINTOS: la conversión se rechaza y no se publica.')
        print(f'Comparación completa OK: {original_hash[0][0]:,} historiales y '
              f'{original_hash[0][1]} metadatos sin cambios.', flush=True)
        print(f'SQLite: {source.stat().st_size / (1024**2):.2f} MiB → '
              f'{destination.stat().st_size / (1024**2):.2f} MiB.', flush=True)
        return destination
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
