import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from scripts.validar_release import validar
class TestsRelease(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.payload = b'WTHDB01\0' + bytes(range(80))
        (self.folder / 'whosthat.db.zst.enc').write_bytes(self.payload)
        self.meta = {'format': 'WTHDB01', 'filename': 'whosthat.db.zst.enc', 'dateEpoch': '2005-04-17', 'sequenceNumber': 123, 'records': 2631265, 'encryptedBytes': len(self.payload), 'sqliteBytes': 74868326, 'sha256': hashlib.sha256(self.payload).hexdigest(), 'statistics': {'users': 3, 'uniqueNames': 3, 'sharedNames': 1, 'usersByNameCount': {'1': 2, '2': 1, '3': 0, '4': 0, '5+': 0}, 'maxNamesPerUser': 2, 'avgNamesPerUser': 1.33, 'firstObserved': '2005-04-17', 'lastObserved': '2026-11-07', 'avgObservedDays': 330.1}}
        self.save()
    def tearDown(self):
        self.temp.cleanup()
    def save(self):
        (self.folder / 'version.json').write_text(json.dumps(self.meta), encoding='utf-8')
    def test_acepta_release_actual(self):
        validar(self.folder)
    def test_rechaza_release_gzip_antiguo(self):
        (self.folder / 'whosthat.db.zst.enc').rename(self.folder / 'whosthat.db.gz.enc')
        self.meta['filename'] = 'whosthat.db.gz.enc'
        self.save()
        with self.assertRaisesRegex(ValueError,'formato de fechas relativas'):
            validar(self.folder)
    def test_rechaza_extension_desconocida(self):
        self.meta['filename'] = 'whosthat.db.otro.enc'
        self.save()
        with self.assertRaisesRegex(ValueError,'formato de fechas relativas'):
            validar(self.folder)
    def test_rechaza_manifiesto_sin_estadisticas(self):
        self.meta.pop('statistics')
        self.save()
        with self.assertRaisesRegex(ValueError,'Estadísticas del manifiesto obligatorias'):
            validar(self.folder)
    def test_rechaza_estadisticas_incoherentes(self):
        self.meta['statistics'] = {'users': 3, 'uniqueNames': 3, 'sharedNames': 1, 'usersByNameCount': {'1': 4, '2': 1, '3': 0, '4': 0, '5+': 0}, 'maxNamesPerUser': 2, 'avgNamesPerUser': 1.33, 'firstObserved': '2005-04-17', 'lastObserved': '2026-11-07', 'avgObservedDays': 330.1}
        self.save()
        with self.assertRaisesRegex(ValueError,'Recuentos estadísticos incoherentes'):
            validar(self.folder)
    def test_rechaza_fecha_base_incorrecta(self):
        self.meta['dateEpoch'] = '2005-04-18'
        self.save()
        with self.assertRaisesRegex(ValueError, 'fechas relativas'):
            validar(self.folder)
    def test_rechaza_archivo_cifrado_distinto(self):
        (self.folder / 'whosthat.db.zst.enc').write_bytes(self.payload + b'X')
        with self.assertRaisesRegex(ValueError, 'tamaño'):
            validar(self.folder)
    def test_rechaza_checksum_distinto(self):
        self.meta['sha256'] = '0' * 64
        self.save()
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            validar(self.folder)
if __name__ == '__main__':
    unittest.main()
