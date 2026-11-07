import argparse
import hashlib
import json
from pathlib import Path
import re
MAGIC = b'WTHDB01\x00'
def validar(folder):
    folder = Path(folder)
    manifest = folder / 'version.json'
    encrypted = folder / 'whosthat.db.gz.enc'
    if not manifest.is_file() or not encrypted.is_file():
        raise ValueError('Faltan version.json o whosthat.db.gz.enc')
    data = json.loads(manifest.read_text(encoding='utf-8'))
    if data.get('format') != 'WTHDB01' or data.get('filename') != encrypted.name or data.get('dateEpoch') != '2005-04-17':
        raise ValueError('El manifiesto no corresponde al formato de fechas relativas requerido')
    for key in ('sequenceNumber', 'records', 'encryptedBytes', 'sqliteBytes'):
        value = data.get(key)
        if type(value) is not int or value <= 0:
            raise ValueError('Valor inválido en el manifiesto: ' + key)
    if data['encryptedBytes'] != encrypted.stat().st_size or data['encryptedBytes'] <= 52:
        raise ValueError('El tamaño de la base cifrada no coincide con el manifiesto')
    if not isinstance(data.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', data['sha256']):
        raise ValueError('SHA-256 inválido en el manifiesto')
    digest = hashlib.sha256()
    with encrypted.open('rb') as file:
        if file.read(len(MAGIC)) != MAGIC:
            raise ValueError('La cabecera AES/GZIP no es la esperada')
        file.seek(0)
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != data['sha256']:
        raise ValueError('SHA-256 del archivo no coincide con version.json')
    print(f"Release de SQLite válido: {data['records']:,} registros, secuencia {data['sequenceNumber']}, {data['encryptedBytes'] / 1048576:.2f} MiB cifrados.")
def main():
    parser = argparse.ArgumentParser(description='Validar los archivos cifrados y su manifiesto sin descifrar')
    parser.add_argument('carpeta', type=Path)
    args = parser.parse_args()
    validar(args.carpeta)
if __name__ == '__main__':
    main()
