import hashlib
import json
import os
import shutil
from contextlib import closing
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
from validar_release import validar
class TestsFlujo(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.raw = self.folder / 'original.sqlite'
        self.enc = self.folder / 'whosthat.db.zst.enc'
        self.manifest = self.folder / 'version.json'
        self.password = 'Clave-de-prueba-local'
        with closing(sqlite3.connect(self.raw)) as con, con:
            con.execute(WHOSTHAT_DDL)
            con.execute('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            con.executemany('INSERT INTO metadata VALUES (?,?)', [('sequenceNumber','100'),('dateEpoch',EPOCH_TEXT)])
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
        validar(self.folder)
        data = json.loads(self.manifest.read_text())
        self.assertEqual(data['sequenceNumber'],101)
        self.assertEqual(data['records'],3)
        self.assertEqual(set(data),{'format','dateEpoch','filename','sequenceNumber','records','statistics','updatedAt','encryptedBytes','sqliteBytes','sha256'})
        self.assertEqual(data['dateEpoch'],EPOCH_TEXT)
        self.assertEqual(data['statistics']['users'],3)
        self.assertEqual(data['statistics']['uniqueNames'],3)
        self.assertEqual(data['statistics']['usersByNameCount'],{'1':3,'2':0,'3':0,'4':0,'5+':0})
        self.assertEqual(data['statistics']['lastObserved'],'2026-03-01')
        self.assertEqual(data['sha256'],hashlib.sha256(self.enc.read_bytes()).hexdigest())
        restored=self.folder/'restaurado.sqlite'
        decrypt_database(self.enc,restored,self.password)
        with closing(sqlite3.connect(restored)) as con, con:
            self.assertEqual(validate_schema(con,integrity=True),{'sequenceNumber':'101','dateEpoch':EPOCH_TEXT})
            rows=con.execute('SELECT user_id,user_name,date_first,date_span FROM whosthat ORDER BY user_id').fetchall()
            self.assertEqual(len(rows),3)
            self.assertEqual((to_text(rows[0][2]),to_text(rows[0][2]+rows[0][3])),('2025-12-01','2026-01-05'))
            self.assertEqual((to_text(rows[2][2]),to_text(rows[2][2]+rows[2][3])),('2026-02-28','2026-03-01'))
            self.assertEqual([x[1] for x in rows],['Alba','CASE','Ñandú 🧭'])
    def test_metadatos_extra_se_rechazan_sin_publicar(self):
        before=(self.enc.read_bytes(),self.manifest.read_bytes())
        with closing(sqlite3.connect(self.raw)) as con, con:
            con.execute("INSERT INTO metadata VALUES ('campo_innecesario','1')")
        with patch.object(publisher,'decrypt_database',side_effect=lambda src,dst,password: shutil.copyfile(self.raw,dst)):
            with self.assertRaisesRegex(ValueError,'Metadatos SQLite incorrectos'):
                self.run_publisher()
        self.assertEqual((self.enc.read_bytes(),self.manifest.read_bytes()),before)
    def test_estadisticas_excluyen_nombres_vacios_y_cuentan_compartidos(self):
        with closing(sqlite3.connect(self.raw)) as con, con:
            con.executemany('INSERT INTO whosthat VALUES (?,?,?,?)', [(3,'Alba',to_days('2026-02-01'),5),(3,'Otro',to_days('2026-02-02'),2),(4,'',to_days('2026-02-03'),0)])
        from crypto_db import calculate_statistics
        with closing(sqlite3.connect(self.raw)) as con, con:
            stats = calculate_statistics(con)
        self.assertEqual(stats['users'],3)
        self.assertEqual(stats['uniqueNames'],3)
        self.assertEqual(stats['sharedNames'],1)
        self.assertEqual(stats['usersByNameCount'],{'1':2,'2':1,'3':0,'4':0,'5+':0})
        self.assertEqual(stats['maxNamesPerUser'],2)
        self.assertEqual(stats['avgNamesPerUser'],1.33)
        self.assertEqual(stats['firstObserved'],'2026-01-01')
        self.assertEqual(stats['lastObserved'],'2026-02-06')
    def test_error_diff_no_modifica_archivos_cifrados(self):
        before=(self.enc.read_bytes(),self.manifest.read_bytes())
        with patch.object(updater, 'remote_state', return_value=101), patch.object(updater, 'fetch_and_parse', side_effect=RuntimeError('fallo simulado')):
            with self.assertRaisesRegex(RuntimeError,'fallo simulado'):
                self.run_publisher()
        self.assertEqual((self.enc.read_bytes(),self.manifest.read_bytes()),before)
    def test_vacuum_compacta_antes_del_cifrado(self):
        with closing(sqlite3.connect(self.raw)) as con, con:
            con.executemany('INSERT INTO whosthat VALUES (?,?,?,?)', ((uid,'Nombre-' + str(uid) + '-' * 180,to_days('2026-01-01'),0) for uid in range(10,2500)))
            con.execute('DELETE FROM whosthat WHERE user_id>=10')
            self.assertGreater(con.execute('PRAGMA freelist_count').fetchone()[0],0)
        before=self.raw.stat().st_size
        encrypt_database(self.raw,self.enc,self.password,version_path=self.manifest)
        with patch.object(updater,'remote_state',return_value=100):
            self.run_publisher()
        manifest=json.loads(self.manifest.read_text())
        self.assertLess(manifest['sqliteBytes'],before)
        self.assertEqual(manifest['sequenceNumber'],100)
        self.assertEqual(manifest['records'],2)
        recovered=self.folder/'compactada.sqlite'
        decrypt_database(self.enc,recovered,self.password)
        with closing(sqlite3.connect(recovered)) as con, con:
            self.assertEqual(con.execute('PRAGMA freelist_count').fetchone()[0],0)
            self.assertEqual(validate_schema(con,integrity=True),{'sequenceNumber':'100','dateEpoch':EPOCH_TEXT})
        validar(self.folder)
    def test_error_vacuum_no_modifica_archivos_publicables(self):
        before=(self.enc.read_bytes(),self.manifest.read_bytes())
        with patch.object(updater,'remote_state',return_value=100),patch.object(publisher,'compact_database',side_effect=RuntimeError('fallo VACUUM simulado')):
            with self.assertRaisesRegex(RuntimeError,'fallo VACUUM simulado'):
                self.run_publisher()
        self.assertEqual((self.enc.read_bytes(),self.manifest.read_bytes()),before)
    def test_zstd_diez_y_cifrado_compatible(self):
        from crypto_db import zstandard
        with patch('crypto_db.zstandard.ZstdCompressor', wraps=zstandard.ZstdCompressor) as compressor:
            encrypt_database(self.raw,self.enc,self.password,version_path=self.manifest)
        compressor.assert_called_once_with(level=10)
        restored=self.folder/'zopfli.sqlite'
        decrypt_database(self.enc,restored,self.password)
        self.assertEqual(restored.read_bytes(),self.raw.read_bytes())
        validar(self.folder)
    def test_lee_copia_legacy_gzip_sin_alterar_la_sqlite(self):
        import gzip
        from crypto_db import MAGIC, derive, SALT_BYTES, IV_BYTES
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        legacy=self.folder/'whosthat.db.gz.enc'
        salt=os.urandom(SALT_BYTES)
        iv=os.urandom(IV_BYTES)
        legacy.write_bytes(MAGIC+salt+iv+AESGCM(derive(self.password,salt)).encrypt(iv,gzip.compress(self.raw.read_bytes()),None))
        restored=self.folder/'legacy.sqlite'
        decrypt_database(legacy,restored,self.password)
        self.assertEqual(restored.read_bytes(),self.raw.read_bytes())
    def test_migracion_release_gzip_conserva_salt_y_publica_zstd(self):
        import gzip
        from crypto_db import MAGIC, derive, inspect_header
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        legacy=self.folder/'whosthat.db.gz.enc'
        salt=os.urandom(16)
        iv=os.urandom(12)
        legacy.write_bytes(MAGIC+salt+iv+AESGCM(derive(self.password,salt)).encrypt(iv,gzip.compress(self.raw.read_bytes()),None))
        self.enc.unlink()
        with patch.object(updater,'remote_state',return_value=100):
            self.run_publisher()
        self.assertEqual(inspect_header(self.enc)[0],salt)
        self.assertEqual(json.loads(self.manifest.read_text())['filename'],'whosthat.db.zst.enc')
        restored=self.folder/'migrada.sqlite'
        decrypt_database(self.enc,restored,self.password)
        with closing(sqlite3.connect(restored)) as migrada, closing(sqlite3.connect(self.raw)) as origen:
            self.assertEqual(migrada.execute('SELECT * FROM whosthat ORDER BY user_id,user_name').fetchall(),origen.execute('SELECT * FROM whosthat ORDER BY user_id,user_name').fetchall())
        validar(self.folder)
    def test_error_zstd_no_modifica_archivos_publicables(self):
        before=(self.enc.read_bytes(),self.manifest.read_bytes())
        with patch.object(updater,'remote_state',return_value=100),patch('crypto_db.zstandard.ZstdCompressor',side_effect=RuntimeError('fallo ZSTD simulado')):
            with self.assertRaisesRegex(RuntimeError,'fallo ZSTD simulado'):
                self.run_publisher()
        self.assertEqual((self.enc.read_bytes(),self.manifest.read_bytes()),before)
    def test_esquema_rechaza_indice_secundario(self):
        with closing(sqlite3.connect(self.raw)) as con, con:
            con.execute('CREATE INDEX indice_extra ON whosthat(user_name)')
            with self.assertRaisesRegex(ValueError,'índices secundarios'):
                validate_schema(con)
if __name__ == '__main__':
    unittest.main()
