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
class TestsActualizacion(unittest.TestCase):
    def setUp(self):
        self.con = sqlite3.connect(':memory:', isolation_level=None)
        self.con.execute('CREATE TABLE whosthat (user_id INTEGER NOT NULL, user_name TEXT NOT NULL, date_first TEXT NOT NULL, date_last TEXT NOT NULL, PRIMARY KEY(user_id, user_name)) WITHOUT ROWID')
        self.con.execute('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        self.con.execute("INSERT INTO metadata VALUES ('sequenceNumber', '100')")
        self.initial = [(1, '  doble  nombre  ', '2026-01-03', '2026-01-10'), (2, 'CASE', '2026-01-03', '2026-01-10'), (3, 'case', '2026-01-03', '2026-01-10'), (4, 'emoji🧭', '2026-01-03', '2026-01-10'), (5, 'stationary', '2026-01-02', '2026-01-10')]
        self.con.executemany('INSERT INTO whosthat VALUES (?, ?, ?, ?)', self.initial)
        self.rows = [(1, '  doble  nombre  ', '2026-01-03', '2026-01-10'), (2, 'CASE', '2026-01-02', '2026-01-10'), (3, 'case', '2026-01-03', '2026-01-11'), (4, 'emoji🧭', '2026-01-01', '2026-01-12'), (5, 'stationary', '2026-01-04', '2026-01-07'), (6, 'nuevo', '2026-01-08', '2026-01-08'), (7, '  otro  ', '2026-01-09', '2026-01-09'), (8, 'Ñandú', '2026-01-06', '2026-01-06')]
    def tearDown(self):
        self.con.close()
    def snapshot(self, con):
        return (con.execute('SELECT * FROM whosthat ORDER BY user_id, user_name').fetchall(), con.execute("SELECT value FROM metadata WHERE key='sequenceNumber'").fetchone()[0])
    def test_recuentos_reales_y_fechas(self):
        self.assertEqual(updater.apply_diff(self.con, 101, self.rows), (3, 3, 2))
        saved, seq = self.snapshot(self.con)
        self.assertEqual(seq, '101')
        self.assertEqual(len(saved), 8)
        self.assertIn((2, 'CASE', '2026-01-02', '2026-01-10'), saved)
        self.assertIn((3, 'case', '2026-01-03', '2026-01-11'), saved)
        self.assertIn((4, 'emoji🧭', '2026-01-01', '2026-01-12'), saved)
        self.assertIn((1, '  doble  nombre  ', '2026-01-03', '2026-01-10'), saved)
        self.assertIn((5, 'stationary', '2026-01-02', '2026-01-10'), saved)
    def test_repeticion_no_inventa_cambios(self):
        self.assertEqual(updater.apply_diff(self.con, 101, self.rows), (3, 3, 2))
        self.assertEqual(updater.apply_diff(self.con, 102, self.rows), (0, 0, len(self.rows)))
        self.assertEqual(self.snapshot(self.con)[1], '102')
    def test_lote_vacio(self):
        self.assertEqual(updater.apply_diff(self.con, 101, []), (0, 0, 0))
        self.assertEqual(self.snapshot(self.con)[1], '101')
        self.assertEqual(len(self.snapshot(self.con)[0]), 5)
    def test_error_secuencia_rollback(self):
        original = self.snapshot(self.con)
        with self.assertRaisesRegex(ValueError, 'Secuencia inesperada'):
            updater.apply_diff(self.con, 103, self.rows)
        self.assertEqual(self.snapshot(self.con), original)
    def test_error_datos_rollback(self):
        original = self.snapshot(self.con)
        bad = [(9, 'x', '2026-01-10', '2026-01-10'), (10, 'y', None, '2026-01-10')]
        with self.assertRaises(sqlite3.IntegrityError):
            updater.apply_diff(self.con, 101, bad)
        self.assertEqual(self.snapshot(self.con), original)
        self.assertEqual(updater.apply_diff(self.con, 101, self.rows), (3, 3, 2))
    def test_coincide_con_upsert_original(self):
        original = sqlite3.connect(':memory:', isolation_level=None)
        try:
            self.con.backup(original)
            updater.apply_diff(self.con, 101, self.rows)
            original.executemany(updater.UPSERT, self.rows)
            original.execute("UPDATE metadata SET value='101' WHERE key='sequenceNumber'")
            second = [(2, 'CASE', '2026-01-01', '2026-01-15'), (4, 'emoji🧭', '2026-01-05', '2026-01-16'), (6, 'nuevo', '2026-01-08', '2026-01-08'), (99, 'nuevo2', '2026-01-16', '2026-01-16')]
            self.assertEqual(updater.apply_diff(self.con, 102, second), (1, 2, 1))
            original.executemany(updater.UPSERT, second)
            original.execute("UPDATE metadata SET value='102' WHERE key='sequenceNumber'")
            self.assertEqual(self.snapshot(self.con), self.snapshot(original))
        finally:
            original.close()
    def test_rechazo_de_duplicados_sin_efectos_parciales(self):
        original = self.snapshot(self.con)
        with self.assertRaises(sqlite3.IntegrityError):
            updater.apply_diff(self.con, 101, [self.rows[0], self.rows[0]])
        self.assertEqual(self.snapshot(self.con), original)
    def test_ejecucion_y_registros_con_mock_sin_red(self):
        with tempfile.TemporaryDirectory() as temp:
            db = Path(temp) / 'test.sqlite'
            persisted = sqlite3.connect(db, isolation_level=None)
            try:
                self.con.backup(persisted)
            finally:
                persisted.close()
            output = io.StringIO()
            datasets = {101: (self.rows, 0.30, 0.10), 102: (self.rows, 0.25, 0.12)}
            with patch.object(updater, 'remote_state', return_value=102), patch.object(updater, 'fetch_and_parse', side_effect=lambda source, seq: datasets[seq]), contextlib.redirect_stdout(output):
                updater.run(db, 'https://invalid.local', None, False, 2)
            text = output.getvalue()
            self.assertIn('nuevos 3, actualizados 3, sin cambios 2', text)
            self.assertIn('nuevos 0, actualizados 0, sin cambios 8', text)
            self.assertIn('RESUMEN DATOS: 16 pares procesados; nuevos 3, actualizados 3, sin cambios 10.', text)
            self.assertIn('TIEMPOS DIFFS:', text)
            self.assertIn('suma paralela', text)
            check = sqlite3.connect(db)
            try:
                self.assertEqual(check.execute("SELECT value FROM metadata WHERE key='sequenceNumber'").fetchone()[0], '102')
                self.assertEqual(check.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            finally:
                check.close()
    def test_estado_al_dia_sin_descargas(self):
        with tempfile.TemporaryDirectory() as temp:
            db = Path(temp) / 'test.sqlite'
            disk = sqlite3.connect(db)
            try:
                self.con.backup(disk)
            finally:
                disk.close()
            output = io.StringIO()
            with patch.object(updater, 'remote_state', return_value=100), patch.object(updater, 'fetch_and_parse', side_effect=AssertionError('No debe descargar')), contextlib.redirect_stdout(output):
                updater.run(db, 'https://invalid.local', None, False, 2)
            self.assertIn('Ya está al día.', output.getvalue())
            self.assertIn('RESUMEN DATOS: 0 pares', output.getvalue())
    def test_fetch_and_parse_tiempos(self):
        content = b'<osmChange><modify><node uid="5" user="Usuario" timestamp="2026-01-01T12:00:00Z" /></modify></osmChange>'
        def fake_request(url, dest):
            Path(dest).write_bytes(gzip.compress(content))
        with patch.object(updater, 'request', side_effect=fake_request):
            rows, download_seconds, parse_seconds = updater.fetch_and_parse('https://invalid.local', 101)
        self.assertEqual(rows, [(5, 'Usuario', '2026-01-01', '2026-01-01')])
        self.assertGreaterEqual(download_seconds, 0)
        self.assertGreaterEqual(parse_seconds, 0)
if __name__ == '__main__':
    unittest.main()
