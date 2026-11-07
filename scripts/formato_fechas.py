from datetime import date
import sqlite3
EPOCH_TEXT = '2005-04-17'
EPOCH = date.fromisoformat(EPOCH_TEXT)
SCHEMA_VERSION = '2'
WHOSTHAT_DDL = 'CREATE TABLE whosthat(user_id INTEGER NOT NULL,user_name TEXT NOT NULL,date_first INTEGER NOT NULL,date_span INTEGER NOT NULL CHECK(date_span >= 0),PRIMARY KEY(user_id,user_name)) WITHOUT ROWID'
def to_days(value):
    if not isinstance(value, str) or len(value) != 10 or value[4] != '-' or value[7] != '-':
        raise ValueError('Fecha incorrecta: ' + str(value))
    observed = date.fromisoformat(value)
    if observed.isoformat() != value:
        raise ValueError('Fecha no canónica: ' + value)
    return (observed - EPOCH).days
def to_text(offset):
    if type(offset) is not int:
        raise ValueError('El desplazamiento debe ser INTEGER')
    return (EPOCH.fromordinal(EPOCH.toordinal() + offset)).isoformat()
def connect_readonly(path):
    return sqlite3.connect(f'file:{path.resolve()}?mode=ro', uri=True)
def validate_schema(con, integrity=False):
    if integrity and con.execute('PRAGMA integrity_check').fetchone() != ('ok',):
        raise ValueError('Fallo de integridad SQLite')
    objects = con.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex_%'").fetchall()
    tables = {name for typ, name, _ in objects if typ == 'table'}
    if tables != {'whosthat', 'metadata'}:
        raise ValueError('Esquema incorrecto: se requieren únicamente whosthat y metadata')
    if any(typ not in ('table', 'index') for typ, _, _ in objects):
        raise ValueError('Objetos SQLite inesperados')
    if any(typ == 'index' for typ, _, _ in objects):
        raise ValueError('El formato exclusivo v2 no admite índices secundarios')
    columns = [(r[1], r[2].upper(), r[3], r[5]) for r in con.execute('PRAGMA table_info(whosthat)')]
    if columns != [('user_id', 'INTEGER', 1, 1), ('user_name', 'TEXT', 1, 2), ('date_first', 'INTEGER', 1, 0), ('date_span', 'INTEGER', 1, 0)]:
        raise ValueError('La base no usa el formato exclusivo de fechas relativas v2')
    ddl = next(sql for typ, name, sql in objects if typ == 'table' and name == 'whosthat')
    if 'WITHOUT ROWID' not in ddl.upper():
        raise ValueError('La tabla whosthat debe ser WITHOUT ROWID')
    md_columns = [(r[1], r[2].upper(), r[3], r[5]) for r in con.execute('PRAGMA table_info(metadata)')]
    if md_columns != [('key', 'TEXT', 0, 1), ('value', 'TEXT', 1, 0)]:
        raise ValueError('Esquema metadata no válido')
    meta = dict(con.execute('SELECT key,value FROM metadata'))
    if meta.get('schemaVersion') != SCHEMA_VERSION or meta.get('dateEpoch') != EPOCH_TEXT:
        raise ValueError('Versión o fecha base incorrectas: se exige schemaVersion=2 y dateEpoch=2005-04-17')
    if not str(meta.get('sequenceNumber', '')).isdigit():
        raise ValueError('sequenceNumber incorrecto')
    return meta
def assert_data_ranges(con):
    bad = con.execute("SELECT 1 FROM whosthat WHERE typeof(user_id) <> 'integer' OR typeof(user_name) <> 'text' OR typeof(date_first) <> 'integer' OR typeof(date_span) <> 'integer' OR date_span < 0 OR user_id <= 0 LIMIT 1").fetchone()
    if bad:
        raise ValueError('Se detectaron registros con tipos o fechas no válidos')
    bounds = con.execute('SELECT MIN(date_first),MAX(date_first+date_span) FROM whosthat').fetchone()
    for bound in bounds:
        if bound is not None:
            to_text(bound)
