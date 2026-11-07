import contextlib
import gzip
import io
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import actualizar_whosthat_rapido as updater
from formato_fechas import EPOCH_TEXT, WHOSTHAT_DDL, to_days, to_text, validate_schema
class TestsActualizacion(unittest.TestCase):
    def setUp(self):
        self.con = sqlite3.connect(':memory:', isolation_level=None)
        self.con.execute(WHOSTHAT_DDL)
        self.con.execute('CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        self.con.executemany('INSERT INTO metadata VALUES (?,?)', [('sequenceNumber','100'),('schemaVersion','2'),('dateEpoch',EPOCH_TEXT)])
        self.initial = [(1, '  doble  nombre  ', '2026-01-03', '2026-01-10'), (2, 'CASE', '2026-01-03', '2026-01-10'), (3, 'case', '2026-01-03', '2026-01-10'), (4, 'emoji🧭', '2026-01-03', '2026-01-10'), (5, 'stationary', '2026-01-02', '2026-01-10')]
        self.con.executemany('INSERT INTO whosthat VALUES (?,?,?,?)', ((uid,name,to_days(first),to_days(last)-to_days(first)) for uid,name,first,last in self.initial))
        self.rows = [(1, '  doble  nombre  ', '2026-01-03', '2026-01-10'), (2, 'CASE', '2026-01-02', '2026-01-10'), (3, 'case', '2026-01-03', '2026-01-11'), (4, 'emoji🧭', '2026-01-01', '2026-01-12'), (5, 'stationary', '2026-01-04', '2026-01-07'), (6, 'nuevo', '2026-01-08', '2026-01-08'), (7, '  otro  ', '2026-01-09', '2026-01-09'), (8, 'Ñandú', '2026-01-06', '2026-01-06')]
    def tearDown(self):
        self.con.close()
    def snapshot(self):
        rows = self.con.execute('SELECT * FROM whosthat ORDER BY user_id,user_name').fetchall()
        return [(uid,name,to_text(first),to_text(first+span)) for uid,name,first,span in rows],self.con.execute("SELECT value FROM metadata WHERE key='sequenceNumber'").fetchone()[0]
    def test_recuentos_reales_y_fechas(self):
        self.assertEqual(updater.apply_diff(self.con, 101, self.rows), (3,3,2))
        saved,seq=self.snapshot()
        self.assertEqual(seq,'101')
        self.assertEqual(len(saved),8)
        for expected in [(2,'CASE','2026-01-02','2026-01-10'),(3,'case','2026-01-03','2026-01-11'),(4,'emoji🧭','2026-01-01','2026-01-12'),(5,'stationary','2026-01-02','2026-01-10')]:
            self.assertIn(expected,saved)
    def test_repeticion_no_inventa_cambios(self):
        updater.apply_diff(self.con,101,self.rows)
        self.assertEqual(updater.apply_diff(self.con,102,self.rows),(0,0,len(self.rows)))
    def test_lote_vacio(self):
        self.assertEqual(updater.apply_diff(self.con,101,[]),(0,0,0))
        self.assertEqual(len(self.snapshot()[0]),5)
    def test_error_secuencia_rollback(self):
        original=self.snapshot()
        with self.assertRaisesRegex(ValueError,'Secuencia inesperada'):
            updater.apply_diff(self.con,103,self.rows)
        self.assertEqual(self.snapshot(),original)
    def test_fechas_invertidas(self):
        old=self.snapshot()
        with self.assertRaisesRegex(ValueError,'negativo'):
            updater.apply_diff(self.con,101,[(9,'fail','2026-01-12','2026-01-10')])
        self.assertEqual(self.snapshot(),old)
    def test_lote_duplicado_rechazado(self):
        old=self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError):
            updater.apply_diff(self.con,101,self.rows+self.rows[:1])
        self.assertEqual(self.snapshot(),old)
    def test_fechas_bisiestas(self):
        self.assertEqual(to_days('2005-04-17'),0)
        self.assertEqual(to_text(to_days('2024-02-29')),'2024-02-29')
        with self.assertRaises(ValueError):
            to_days('2026-02-30')
    def test_rechaza_v1(self):
        self.con.execute("UPDATE metadata SET value='1' WHERE key='schemaVersion'")
        with self.assertRaisesRegex(ValueError,'Versión'):
            updater.apply_diff(self.con,101,self.rows)
    def test_extrae_nombres_unicode(self):
        payload='<osmChange><modify><node id="1" uid="9" user="Ñandú 🧭" timestamp="2026-01-03T12:00:00Z"/><way id="2" uid="9" user="Ñandú 🧭" timestamp="2026-01-04T12:00:00Z"/></modify></osmChange>'
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'diff.gz'
            with gzip.open(file,'wb') as out:
                out.write(payload.encode())
            self.assertEqual(updater.extract_users(file),[(9,'Ñandú 🧭','2026-01-03','2026-01-04')])
    def test_diff_url(self):
        self.assertEqual(updater.diff_url('https://example.net/replication/hour',12345678),'https://example.net/replication/hour/012/345/678.osc.gz')
    def test_metadata_se_conserva(self):
        updater.apply_diff(self.con,101,self.rows)
        self.assertEqual(validate_schema(self.con)['dateEpoch'],EPOCH_TEXT)
        self.assertEqual(validate_schema(self.con)['schemaVersion'],'2')
    def test_inicio_retroactivo_actualiza_duracion(self):
        updater.apply_diff(self.con,101,[(1,'  doble  nombre  ','2025-12-01','2026-01-04')])
        self.assertIn((1,'  doble  nombre  ','2025-12-01','2026-01-10'),self.snapshot()[0])
if __name__ == '__main__':
    unittest.main()
