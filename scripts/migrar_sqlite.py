import argparse
from datetime import date
import getpass
import hashlib
import importlib.util
import itertools
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import venv
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from formato_fechas import EPOCH_TEXT, SCHEMA_VERSION, WHOSTHAT_DDL, assert_data_ranges, connect_readonly, to_days, to_text, validate_schema
def bootstrap():
    if importlib.util.find_spec('cryptography') is not None:
        return
    if os.environ.get('WHOSTHAT_MIGRACION_VENV') == '1':
        raise RuntimeError('No se pudo instalar cryptography en el entorno virtual')
    folder = Path.home() / '.cache' / 'whosthat-migracion' / f'python-{sys.version_info.major}.{sys.version_info.minor}'
    exe = folder / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not exe.is_file():
        print('Creando entorno virtual aislado...', flush=True)
        folder.parent.mkdir(parents=True, exist_ok=True)
        try:
            venv.EnvBuilder(with_pip=True).create(folder)
        except Exception as exc:
            raise RuntimeError('No se pudo crear el entorno virtual: ' + str(exc)) from exc
    print('Instalando cryptography solo en ese entorno...', flush=True)
    subprocess.run([str(exe), '-m', 'pip', 'install', '--disable-pip-version-check', 'cryptography'], check=True)
    env = dict(os.environ, WHOSTHAT_MIGRACION_VENV='1')
    raise SystemExit(subprocess.run([str(exe), '-m', 'scripts.migrar_sqlite', *sys.argv[1:]], cwd=ROOT, env=env).returncode)
def verify_old(con):
    if con.execute('PRAGMA integrity_check').fetchone() != ('ok',):
        raise ValueError('El SQLite original no supera integrity_check')
    cols = [(r[1], r[2].upper(), r[3], r[5]) for r in con.execute('PRAGMA table_info(whosthat)')]
    if cols != [('user_id', 'INTEGER', 1, 1), ('user_name', 'TEXT', 1, 2), ('date_first', 'TEXT', 1, 0), ('date_last', 'TEXT', 1, 0)]:
        raise ValueError('La base no tiene el formato antiguo esperado: migración rechazada')
    md = [(r[1], r[2].upper(), r[3], r[5]) for r in con.execute('PRAGMA table_info(metadata)')]
    if md != [('key', 'TEXT', 0, 1), ('value', 'TEXT', 1, 0)]:
        raise ValueError('Tabla metadata original no reconocida')
    objects = con.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex_%'").fetchall()
    if {name for typ, name, _ in objects if typ == 'table'} != {'whosthat', 'metadata'} or any(typ not in ('table', 'index') for typ, _, _ in objects):
        raise ValueError('El SQLite original contiene objetos inesperados')
    meta = dict(con.execute('SELECT key,value FROM metadata'))
    if 'schemaVersion' in meta or 'dateEpoch' in meta or not str(meta.get('sequenceNumber', '')).isdigit():
        raise ValueError('El SQLite original ya tiene otro esquema o sequenceNumber inválido')
    minimum = con.execute('SELECT MIN(date_first) FROM whosthat').fetchone()[0]
    if minimum != EPOCH_TEXT:
        raise ValueError('La fecha mínima original no coincide con la fecha base esperada: ' + str(minimum))
    return meta
def hash_field(hasher, value):
    if isinstance(value, int):
        kind, data = b'I', str(value).encode('ascii')
    elif isinstance(value, str):
        kind, data = b'T', value.encode('utf-8', 'surrogatepass')
    else:
        raise ValueError('Tipo de campo inesperado en comparación')
    hasher.update(kind)
    hasher.update(len(data).to_bytes(8, 'big'))
    hasher.update(data)
def verify_equal(original, migrated):
    digest_a = hashlib.sha256()
    digest_b = hashlib.sha256()
    old_rows = original.execute('SELECT user_id,user_name,date_first,date_last FROM whosthat ORDER BY user_id,user_name COLLATE BINARY')
    new_rows = migrated.execute('SELECT user_id,user_name,date_first,date_span FROM whosthat ORDER BY user_id,user_name COLLATE BINARY')
    total = 0
    for old, new in itertools.zip_longest(old_rows, new_rows):
        if old is None or new is None:
            raise ValueError('La migración cambió el número de registros')
        restored = (new[0], new[1], to_text(new[2]), to_text(new[2] + new[3]))
        for field in old:
            hash_field(digest_a, field)
        for field in restored:
            hash_field(digest_b, field)
        if old != restored:
            raise ValueError('Diferencia en datos originales del usuario ' + str(old[0]))
        total += 1
        if total % 500000 == 0:
            print(f'Comparados {total:,} registros...', flush=True)
    old_md = sorted(original.execute('SELECT key,value FROM metadata'), key=lambda row: row[0])
    new_md = sorted(migrated.execute("SELECT key,value FROM metadata WHERE key NOT IN ('dateEpoch','schemaVersion')"), key=lambda row: row[0])
    if old_md != new_md:
        raise ValueError('Se han modificado metadatos originales')
    if digest_a.digest() != digest_b.digest():
        raise ValueError('SHA-256 de todos los datos no coincide')
    return total, digest_a.hexdigest()
def convert(source, target):
    with connect_readonly(source) as original:
        meta = verify_old(original)
        print('Transformando fecha inicial y duración...', flush=True)
        with sqlite3.connect(target) as new:
            new.execute('PRAGMA page_size=4096')
            new.execute('PRAGMA journal_mode=DELETE')
            new.execute('PRAGMA cache_size=-32768')
            new.execute(f"PRAGMA user_version={original.execute('PRAGMA user_version').fetchone()[0]}")
            new.execute(f"PRAGMA application_id={original.execute('PRAGMA application_id').fetchone()[0]}")
            new.execute('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            new.execute(WHOSTHAT_DDL)
            new.executemany('INSERT INTO metadata VALUES (?,?)', list(meta.items()) + [('schemaVersion', SCHEMA_VERSION), ('dateEpoch', EPOCH_TEXT)])
            cursor = original.execute('SELECT user_id,user_name,date_first,date_last FROM whosthat ORDER BY user_id,user_name')
            count = 0
            while True:
                batch = cursor.fetchmany(10000)
                if not batch:
                    break
                values = []
                for uid, name, first, last in batch:
                    a, b = to_days(first), to_days(last)
                    if b < a:
                        raise ValueError('Intervalo de fechas negativo en UID ' + str(uid))
                    values.append((uid, name, a, b - a))
                new.executemany('INSERT INTO whosthat VALUES (?,?,?,?)', values)
                count += len(values)
                if count % 500000 < len(values):
                    print(f'Convertidos {count:,} registros...', flush=True)
            new.commit()
            validate_schema(new, integrity=True)
            assert_data_ranges(new)
            total, sha = verify_equal(original, new)
            print(f'Integridad verificada: {total:,} registros y metadatos; SHA-256 {sha}', flush=True)
            return total
def main():
    parser = argparse.ArgumentParser(description='Migración única a fechas relativas de Who\'s That?')
    parser.add_argument('--encrypted', type=Path, default=ROOT / 'data' / 'whosthat.db.gz.enc')
    parser.add_argument('--output', type=Path, default=ROOT / 'data' / 'migracion-v2')
    args = parser.parse_args()
    source = args.encrypted.expanduser().resolve()
    if not source.is_file():
        typed = input('Ruta del archivo whosthat.db.gz.enc original: ').strip().strip('"').strip("'")
        source = Path(typed).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError('No existe la base cifrada: ' + str(source))
    output = args.output.expanduser().resolve()
    enc_target = output / 'whosthat.db.gz.enc'
    manifest_target = output / 'version.json'
    if source == enc_target or enc_target.exists() or manifest_target.exists():
        raise FileExistsError('El destino ya existe o coincide con el original; no se sobrescribe nada')
    bootstrap()
    from crypto_db import decrypt_database, encrypt_database
    password = os.environ.get('WHOSTHAT_DB_PASSWORD') or getpass.getpass('Contraseña de la base original: ')
    with tempfile.TemporaryDirectory(prefix='whosthat-migracion-') as temp:
        folder = Path(temp)
        original = folder / 'original.sqlite'
        target = folder / 'nuevo.sqlite'
        encrypted = folder / 'whosthat.db.gz.enc'
        version = folder / 'version.json'
        print('Descifrando copia temporal sin modificar el original...', flush=True)
        decrypt_database(source, original, password)
        count = convert(original, target)
        print('Cifrando la base nueva con GZIP y AES-256-GCM...', flush=True)
        meta = encrypt_database(target, encrypted, password, preserve_salt_from=source, version_path=version)
        if meta['records'] != count or meta['schemaVersion'] != int(SCHEMA_VERSION) or meta['dateEpoch'] != EPOCH_TEXT:
            raise ValueError('El manifiesto de salida no coincide')
        restored = folder / 'comprobada.sqlite'
        decrypt_database(encrypted, restored, password)
        with connect_readonly(restored) as verified:
            validate_schema(verified, integrity=True)
            if verified.execute('SELECT COUNT(*) FROM whosthat').fetchone()[0] != count:
                raise ValueError('El cifrado no conserva todos los registros')
        if hashlib.sha256(restored.read_bytes()).digest() != hashlib.sha256(target.read_bytes()).digest():
            raise ValueError('Los bytes de SQLite cambiaron tras el cifrado')
        output.mkdir(parents=True, exist_ok=True)
        if enc_target.exists() or manifest_target.exists():
            raise FileExistsError('Se ha creado un archivo de destino durante la migración')
        try:
            shutil.copyfile(encrypted, enc_target)
            shutil.copyfile(version, manifest_target)
        except BaseException:
            enc_target.unlink(missing_ok=True)
            manifest_target.unlink(missing_ok=True)
            raise
        old_size, new_size = original.stat().st_size, target.stat().st_size
        print(f'MIGRACIÓN COMPLETA: {count:,} registros idénticos.', flush=True)
        print(f'SQLite: {old_size/1048576:.2f} MiB -> {new_size/1048576:.2f} MiB ({(old_size-new_size)*100/old_size:.2f}% menos).', flush=True)
        print(f'Salida cifrada: {enc_target}', flush=True)
        print(f'Manifiesto: {manifest_target}', flush=True)
        print('El original sigue intacto. No publiques hasta coordinar el cambio de versión de la aplicación.', flush=True)
if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
