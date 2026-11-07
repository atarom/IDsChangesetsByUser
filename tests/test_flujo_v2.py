import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import actualizar_whosthat_rapido as updater
import actualizar_y_publicar as publisher
from crypto_db import decrypt_database, encrypt_database
from formato_fechas import EPOCH_TEXT, WHOSTHAT_DDL, to_days, to_text, validate_schema
class TestsFlujoV2(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.raw = self.folder / 'original.sqlite'
        self.enc = self.folder / 'whosthat.db.gz.enc'
        self.manifest = self.folder / 'version.json'
        self.password = 'Clave-de-prueba-local'
        with sqlite3.connect(self.raw) as con:
            con.execute(WHOSTHAT_DDL)
            con.execute('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            con.executemany('INSERT INTO metadata VALUES (?,?)', [('sequenceNumber','100'),('schemaVersion','2'),('dateEpoch',EPOCH_TEXT)])
            con.executemany('INSERT INTO whosthat VALUES (?,?,?,?)', [(1,'Alba',to_days('2026-01-01'),1),(2,'CASE',to_days('2026-01-02'),0)])
        encrypt_database(self.raw, self.enc, self.password, version_path=self.manifest)
    def tearDown(self):
        self.temp.cleanup()
    def run_publisher(self):
        args = ['actualizar_y_publicar.py', '--encrypted', str(self.enc), '--version', str(self.manifest), '--source', 'https://example.invalid/replication/hour', '--workers', '1']
        with patch.dict(os.environ, {'WHOSTHAT_DB_PASSWORD': self.password}), patch.object(sys, 'argv', args):
            publisher.main()
    def test_actualizacion_cifrado_publicacion_y_fechas(self):
        diff = [(1,'Alba','2025-12-01','2026-01-05'),(2,'CASE','2026-01-02','2026-01-02'),(3,'Ñandú 🧭','2026-02-28','2026-03-01')]
        with patch.object(updater, 'remote_state', return_value=101), patch.object(updater, 'fetch_and_parse', return_value=(diff, 0.0, 0.0)):
            self.run_publisher()
        data = json.loads(self.manifest.read_text())
        self.assertEqual(data['sequenceNumber'],101)
        self.assertEqual(data['records'],3)
        self.assertEqual(data['schemaVersion'],2)
        self.assertEqual(data['dateEpoch'],EPOCH_TEXT)
        self.assertEqual(data['sha256'],hashlib.sha256(self.enc.read_bytes()).hexdigest())
        restored=self.folder/'restaurado.sqlite'
        decrypt_database(self.enc,restored,self.password)
        with sqlite3.connect(restored) as con:
            self.assertEqual(validate_schema(con,integrity=True)['sequenceNumber'],'101')
            rows=con.execute('SELECT user_id,user_name,date_first,date_span FROM whosthat ORDER BY user_id').fetchall()
            self.assertEqual(len(rows),3)
            self.assertEqual((to_text(rows[0][2]),to_text(rows[0][2]+rows[0][3])),('2025-12-01','2026-01-05'))
            self.assertEqual((to_text(rows[2][2]),to_text(rows[2][2]+rows[2][3])),('2026-02-28','2026-03-01'))
            self.assertEqual([x[1] for x in rows],['Alba','CASE','Ñandú 🧭'])
    def test_error_diff_no_modifica_archivos_cifrados(self):
        before=(self.enc.read_bytes(),self.manifest.read_bytes())
        with patch.object(updater, 'remote_state', return_value=101), patch.object(updater, 'fetch_and_parse', side_effect=RuntimeError('fallo simulado')):
            with self.assertRaisesRegex(RuntimeError,'fallo simulado'):
                self.run_publisher()
        self.assertEqual((self.enc.read_bytes(),self.manifest.read_bytes()),before)
    def test_esquema_rechaza_indice_secundario(self):
        with sqlite3.connect(self.raw) as con:
            con.execute('CREATE INDEX indice_extra ON whosthat(user_name)')
            with self.assertRaisesRegex(ValueError,'índices secundarios'):
                validate_schema(con)
if __name__ == '__main__':
    unittest.main()
