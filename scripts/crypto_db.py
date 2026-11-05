#!/usr/bin/env python3
import argparse
from datetime import datetime, timezone
import getpass
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
MAGIC = b'WTHDB01\x00'
SALT_BYTES = 16
IV_BYTES = 12
KEY_ITERATIONS = 200_000
CHUNK = 1 << 20
def derive(password, salt):
    if not password:
        raise ValueError('La contraseña no puede estar vacía')
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=KEY_ITERATIONS).derive(password.encode('utf-8'))
def inspect_header(enc_path):
    with open(enc_path, 'rb') as file:
        header = file.read(8 + SALT_BYTES + IV_BYTES)
    if len(header) != 36 or header[:8] != MAGIC:
        raise ValueError('Formato de base cifrada no reconocido')
    return header[8:24], header[24:36]
def encrypt_database(db_path, enc_path, password, preserve_salt_from=None, version_path=None):
    db_path = Path(db_path)
    enc_path = Path(enc_path)
    if not db_path.is_file():
        raise FileNotFoundError(db_path)
    con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    try:
        check = con.execute('PRAGMA integrity_check').fetchone()[0]
        if check != 'ok':
            raise ValueError(f'Integridad SQLite incorrecta: {check}')
        seq = con.execute("SELECT value FROM metadata WHERE key='sequenceNumber'").fetchone()[0]
        count = con.execute('SELECT count(*) FROM whosthat').fetchone()[0]
    finally:
        con.close()
    if preserve_salt_from:
        salt, _old_iv = inspect_header(preserve_salt_from)
    elif enc_path.exists():
        salt, _old_iv = inspect_header(enc_path)
    else:
        salt = os.urandom(SALT_BYTES)
    iv = os.urandom(IV_BYTES)
    key = derive(password, salt)
    enc_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='whosthat-encrypt-') as td:
        tgz = Path(td) / 'whosthat.sqlite.gz'
        with open(db_path, 'rb') as raw, open(tgz, 'wb') as dest:
            with gzip.GzipFile(filename='', mode='wb', fileobj=dest, compresslevel=6, mtime=0) as zipped:
                shutil.copyfileobj(raw, zipped, CHUNK)
        temporary_enc = Path(td) / 'whosthat.db.gz.enc'
        encryptor = Cipher(algorithms.AES(key), modes.GCM(iv)).encryptor()
        with open(tgz, 'rb') as zipped, open(temporary_enc, 'wb') as out:
            out.write(MAGIC + salt + iv)
            for chunk in iter(lambda: zipped.read(CHUNK), b''):
                out.write(encryptor.update(chunk))
            out.write(encryptor.finalize())
            out.write(encryptor.tag)
        target_tmp = enc_path.with_suffix(enc_path.suffix + '.tmp')
        shutil.copyfile(temporary_enc, target_tmp)
        target_tmp.replace(enc_path)
    digest = _sha256(enc_path)
    meta = {
        'format': 'WTHDB01',
        'filename': enc_path.name,
        'sequenceNumber': int(seq),
        'records': int(count),
        'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'encryptedBytes': enc_path.stat().st_size,
        'sqliteBytes': db_path.stat().st_size,
        'sha256': digest,
    }
    if version_path:
        Path(version_path).write_text(json.dumps(meta, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return meta
def _sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as src:
        for chunk in iter(lambda: src.read(CHUNK), b''):
            h.update(chunk)
    return h.hexdigest()
def decrypt_database(enc_path, output_path, password):
    enc_path = Path(enc_path)
    output_path = Path(output_path)
    salt, iv = inspect_header(enc_path)
    size = enc_path.stat().st_size
    if size <= 52:
        raise ValueError('Archivo cifrado incompleto')
    with open(enc_path, 'rb') as source:
        source.seek(-16, 2)
        tag = source.read(16)
    decryptor = Cipher(algorithms.AES(derive(password, salt)), modes.GCM(iv, tag)).decryptor()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='whosthat-decrypt-') as td:
        tmp_gz = Path(td) / 'database.sqlite.gz'
        with open(enc_path, 'rb') as source, open(tmp_gz, 'wb') as target:
            source.seek(36)
            remaining = size - 36 - 16
            while remaining:
                chunk = source.read(min(CHUNK, remaining))
                if not chunk:
                    raise EOFError('Archivo cifrado incompleto')
                target.write(decryptor.update(chunk))
                remaining -= len(chunk)
            decryptor.finalize()
        tmp_db = output_path.with_suffix(output_path.suffix + '.tmp')
        try:
            with gzip.open(tmp_gz, 'rb') as gz, open(tmp_db, 'wb') as destination:
                shutil.copyfileobj(gz, destination, CHUNK)
            connection = sqlite3.connect(f'file:{tmp_db}?mode=ro', uri=True)
            try:
                if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise ValueError('Base descifrada no supera quick_check')
            finally:
                connection.close()
            tmp_db.replace(output_path)
        finally:
            tmp_db.unlink(missing_ok=True)
def main():
    p = argparse.ArgumentParser(description='Cifra/descifra bases Who\'s That?')
    sp = p.add_subparsers(dest='cmd', required=True)
    en = sp.add_parser('encrypt'); en.add_argument('sqlite'); en.add_argument('encrypted'); en.add_argument('--version'); en.add_argument('--previous')
    de = sp.add_parser('decrypt'); de.add_argument('encrypted'); de.add_argument('sqlite')
    args = p.parse_args()
    password = os.environ.get('WHOSTHAT_DB_PASSWORD') or getpass.getpass('Contraseña de la base: ')
    if args.cmd == 'encrypt':
        print(encrypt_database(args.sqlite, args.encrypted, password, args.previous, args.version))
    else:
        decrypt_database(args.encrypted, args.sqlite, password)
        print('Base descifrada correctamente:', args.sqlite)
if __name__ == '__main__':
    main()
