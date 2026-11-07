import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from scripts.validar_release import validar
class TestsReleaseV2(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.payload = b'WTHDB01\0' + bytes(range(80))
        (self.folder / 'whosthat.db.gz.enc').write_bytes(self.payload)
        self.meta = {'format': 'WTHDB01', 'filename': 'whosthat.db.gz.enc', 'schemaVersion': 2, 'dateEpoch': '2005-04-17', 'sequenceNumber': 123, 'records': 2631265, 'encryptedBytes': len(self.payload), 'sqliteBytes': 74868326, 'sha256': hashlib.sha256(self.payload).hexdigest()}
        self.save()
    def tearDown(self):
        self.temp.cleanup()
    def save(self):
        (self.folder / 'version.json').write_text(json.dumps(self.meta), encoding='utf-8')
    def test_acepta_release_v2(self):
        validar(self.folder)
    def test_rechaza_formato_antiguo(self):
        self.meta['schemaVersion'] = 1
        self.save()
        with self.assertRaisesRegex(ValueError, 'SQLite v2'):
            validar(self.folder)
    def test_rechaza_archivo_cifrado_distinto(self):
        (self.folder / 'whosthat.db.gz.enc').write_bytes(self.payload + b'X')
        with self.assertRaisesRegex(ValueError, 'tamaño'):
            validar(self.folder)
    def test_rechaza_checksum_distinto(self):
        self.meta['sha256'] = '0' * 64
        self.save()
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            validar(self.folder)
if __name__ == '__main__':
    unittest.main()
