import argparse
import hashlib
import json
import math
from pathlib import Path
import re
MAGIC = b'WTHDB01\x00'
VALID_FILES = {'whosthat.db.gz.enc', 'whosthat.db.zst.enc'}
def validar(folder):
    folder = Path(folder)
    manifest = folder / 'version.json'
    if not manifest.is_file():
        raise ValueError('Falta version.json')
    data = json.loads(manifest.read_text(encoding='utf-8'))
    filename = data.get('filename')
    if data.get('format') != 'WTHDB01' or not isinstance(filename, str) or filename not in VALID_FILES or data.get('dateEpoch') != '2005-04-17':
        raise ValueError('El manifiesto no corresponde al formato de fechas relativas requerido')
    encrypted = folder / filename
    if not encrypted.is_file():
        raise ValueError('Falta el archivo cifrado indicado en version.json: ' + filename)
    for key in ('sequenceNumber', 'records', 'encryptedBytes', 'sqliteBytes'):
        value = data.get(key)
        if type(value) is not int or value <= 0:
            raise ValueError('Valor inválido en el manifiesto: ' + key)
    stats = data.get('statistics')
    if not isinstance(stats, dict):
        raise ValueError('Estadísticas del manifiesto obligatorias')
    buckets = stats.get('usersByNameCount')
    counts = [stats.get(key) for key in ('users', 'uniqueNames', 'sharedNames', 'maxNamesPerUser')]
    if not isinstance(buckets, dict) or set(buckets) != {'1', '2', '3', '4', '5+'} or any(type(value) is not int or value < 0 for value in [*counts, *buckets.values()]):
        raise ValueError('Estadísticas del manifiesto incorrectas')
    if sum(buckets.values()) != stats['users'] or not (0 <= stats['sharedNames'] <= stats['uniqueNames'] <= data['records']) or stats['users'] > data['records']:
        raise ValueError('Recuentos estadísticos incoherentes')
    for key in ('avgNamesPerUser', 'avgObservedDays'):
        if type(stats.get(key)) not in (int, float) or not math.isfinite(stats[key]) or stats[key] < 0:
            raise ValueError('Promedios estadísticos incorrectos')
    first, last = stats.get('firstObserved'), stats.get('lastObserved')
    if not all(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value) for value in (first, last)) or first > last:
        raise ValueError('Fechas estadísticas incorrectas')
    if data['encryptedBytes'] != encrypted.stat().st_size or data['encryptedBytes'] <= 52:
        raise ValueError('El tamaño de la base cifrada no coincide con el manifiesto')
    if not isinstance(data.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', data['sha256']):
        raise ValueError('SHA-256 inválido en el manifiesto')
    digest = hashlib.sha256()
    with encrypted.open('rb') as file:
        if file.read(len(MAGIC)) != MAGIC:
            raise ValueError('La cabecera AES no es la esperada')
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
