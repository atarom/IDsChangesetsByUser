import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from formato_fechas import EPOCH_TEXT, assert_data_ranges, validate_schema, to_text
from migrar_sqlite import convert, verify_old
class TestsMigracion(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.directory=Path(self.temp.name)
        self.original=self.directory/'original.sqlite'
        self.migrated=self.directory/'migrated.sqlite'
        with sqlite3.connect(self.original) as db:
            db.execute('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            db.execute('CREATE TABLE whosthat(user_id INTEGER NOT NULL,user_name TEXT NOT NULL,date_first TEXT NOT NULL,date_last TEXT NOT NULL,PRIMARY KEY(user_id,user_name)) WITHOUT ROWID')
            db.executemany('INSERT INTO metadata VALUES (?,?)',[('sequenceNumber','100'),('custom','ñ'),('status','actualizada')])
            db.executemany('INSERT INTO whosthat VALUES (?,?,?,?)',[(1,'Primero',EPOCH_TEXT,EPOCH_TEXT),(1,'Último','2024-02-29','2024-03-05'),(2,'  con espacios  ','2026-01-01','2026-01-01'),(3,'Emoji 🧭','2026-11-07','2026-11-07')])
    def tearDown(self):
        self.temp.cleanup()
    def test_migracion_sin_perdida(self):
        count=convert(self.original,self.migrated)
        self.assertEqual(count,4)
        with sqlite3.connect(self.migrated) as db:
            self.assertEqual(validate_schema(db,integrity=True)['dateEpoch'],EPOCH_TEXT)
            assert_data_ranges(db)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM whosthat').fetchone()[0],4)
            self.assertEqual(dict(db.execute('SELECT key,value FROM metadata'))['custom'],'ñ')
            row=db.execute("SELECT date_first,date_span FROM whosthat WHERE user_name='Último'").fetchone()
            self.assertEqual(to_text(row[0]),'2024-02-29')
            self.assertEqual(to_text(row[0]+row[1]),'2024-03-05')
    def test_original_permanece_intacto(self):
        with self.original.open('rb') as file:
            before=file.read()
        convert(self.original,self.migrated)
        self.assertEqual(self.original.read_bytes(),before)
    def test_rechaza_migracion_doble(self):
        convert(self.original,self.migrated)
        with sqlite3.connect(self.migrated) as db:
            with self.assertRaisesRegex(ValueError,'formato antiguo'):
                verify_old(db)
    def test_rechaza_fecha_base_distinta(self):
        with sqlite3.connect(self.original) as db:
            db.execute("UPDATE whosthat SET date_first='2005-04-18',date_last='2005-04-18' WHERE user_id=1")
        with self.assertRaisesRegex(ValueError,'fecha mínima'):
            convert(self.original,self.migrated)
    def test_rechaza_intervalo_negativo(self):
        with sqlite3.connect(self.original) as db:
            db.execute("UPDATE whosthat SET date_first='2026-01-09',date_last='2026-01-01' WHERE user_id=2")
        with self.assertRaisesRegex(ValueError,'negativo'):
            convert(self.original,self.migrated)
if __name__ == '__main__':
    unittest.main()
