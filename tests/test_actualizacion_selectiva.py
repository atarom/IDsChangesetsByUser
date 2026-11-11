import random
import sqlite3
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import actualizar_whosthat_rapido as updater
from formato_fechas import EPOCH_TEXT, WHOSTHAT_DDL, to_days, validate_schema
UPSERT_ORIGINAL = '''INSERT INTO whosthat (user_id,user_name,date_first,date_span)
VALUES (?,?,?,?)
ON CONFLICT(user_id,user_name) DO UPDATE SET
  date_span=max(whosthat.date_first+whosthat.date_span,excluded.date_first+excluded.date_span)-min(whosthat.date_first,excluded.date_first),
  date_first=min(whosthat.date_first,excluded.date_first)'''
class TestsActualizacionSelectiva(unittest.TestCase):
    def setUp(self):
        self.optimizada = self.connect()
        self.original = self.connect()
    def tearDown(self):
        self.optimizada.close()
        self.original.close()
    def connect(self):
        con = sqlite3.connect(':memory:', isolation_level=None)
        con.execute(WHOSTHAT_DDL)
        con.execute('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        con.executemany('INSERT INTO metadata VALUES (?,?)', [('sequenceNumber','100'),('dateEpoch',EPOCH_TEXT)])
        return con
    def original_diff(self, con, seq, rows):
        validate_schema(con)
        converted = [(uid,name,to_days(first),to_days(last)) for uid,name,first,last in rows]
        con.execute('BEGIN IMMEDIATE')
        try:
            if updater.db_sequence(con) != seq - 1:
                raise ValueError('Secuencia inesperada')
            con.execute('CREATE TEMP TABLE IF NOT EXISTS whosthat_stats_batch (user_id INTEGER NOT NULL,user_name TEXT NOT NULL,date_first INTEGER NOT NULL,date_last INTEGER NOT NULL,PRIMARY KEY(user_id,user_name)) WITHOUT ROWID')
            con.execute('DELETE FROM temp.whosthat_stats_batch')
            con.executemany('INSERT INTO temp.whosthat_stats_batch VALUES (?,?,?,?)',converted)
            changes = con.execute(updater.STATS_SQL).fetchone()
            if sum(changes) != len(rows):
                raise ValueError('Lote no único')
            con.executemany(UPSERT_ORIGINAL, ((uid,name,first,last-first) for uid,name,first,last in converted))
            con.execute("UPDATE metadata SET value=? WHERE key='sequenceNumber'",(str(seq),))
            con.commit()
            return changes
        except Exception:
            con.rollback()
            raise
    def snapshot(self,con):
        return con.execute('SELECT user_id,user_name,date_first,date_span FROM whosthat ORDER BY user_id,user_name').fetchall(),dict(con.execute('SELECT key,value FROM metadata'))
    def apply_both(self,seq,rows):
        original = self.original_diff(self.original,seq,rows)
        optimizada = updater.apply_diff(self.optimizada,seq,rows)
        self.assertEqual(original,optimizada)
        self.assertEqual(self.snapshot(self.original),self.snapshot(self.optimizada))
        return optimizada
    def test_mismo_resultado_y_sin_escrituras_innecesarias(self):
        data = [(1,'Pedro','2026-11-01','2026-11-11'),(2,'CASE','2026-11-03','2026-11-07'),(3,'case','2026-11-03','2026-11-07'),(4,'🧭','2026-11-03','2026-11-07'),(5,'  espacios  ','2026-11-03','2026-11-07')]
        for con in (self.optimizada,self.original):
            con.executemany('INSERT INTO whosthat VALUES (?,?,?,?)',((uid,name,to_days(first),to_days(last)-to_days(first)) for uid,name,first,last in data))
        self.optimizada.execute('CREATE TEMP TABLE escrituras(tipo TEXT NOT NULL)')
        self.optimizada.execute("CREATE TEMP TRIGGER contar_insert AFTER INSERT ON whosthat BEGIN INSERT INTO escrituras VALUES('insert'); END")
        self.optimizada.execute("CREATE TEMP TRIGGER contar_update AFTER UPDATE ON whosthat BEGIN INSERT INTO escrituras VALUES('update'); END")
        incoming = [(1,'Pedro','2026-11-11','2026-11-11'),(2,'CASE','2026-11-01','2026-11-08'),(3,'case','2026-11-03','2026-11-09'),(4,'🧭','2026-10-30','2026-11-10'),(5,'  espacios  ','2026-11-04','2026-11-06'),(6,'Nuevo','2026-11-11','2026-11-11'),(7,'nuevo','2026-11-10','2026-11-11')]
        self.assertEqual(self.apply_both(101,incoming),(2,3,2))
        self.assertEqual(dict(self.optimizada.execute('SELECT tipo,COUNT(*) FROM escrituras GROUP BY tipo')),{'insert':2,'update':3})
        self.optimizada.execute('DELETE FROM escrituras')
        self.assertEqual(self.apply_both(102,incoming),(0,0,7))
        self.assertEqual(self.optimizada.execute('SELECT COUNT(*) FROM escrituras').fetchone()[0],0)
        self.assertEqual(self.apply_both(103,[]),(0,0,0))
        self.assertEqual(self.optimizada.execute('SELECT COUNT(*) FROM escrituras').fetchone()[0],0)
    def test_lote_duplicado_y_secuencia_rollback(self):
        initial = self.snapshot(self.optimizada)
        rows = [(1,'Pedro','2026-11-11','2026-11-11')]
        with self.assertRaises(sqlite3.IntegrityError):
            updater.apply_diff(self.optimizada,101,rows+rows)
        self.assertEqual(self.snapshot(self.optimizada),initial)
        with self.assertRaisesRegex(ValueError,'Secuencia inesperada'):
            updater.apply_diff(self.optimizada,103,rows)
        self.assertEqual(self.snapshot(self.optimizada),initial)
        self.assertEqual(self.apply_both(101,rows),(1,0,0))
    def test_equivalencia_aleatoria_en_multiples_replicas(self):
        rng = random.Random(14112026)
        first_day = date(2025,1,1)
        names = ['a','A','Ñandú','🧭','  alias  ','Pedro','', 'a-b']
        base = {}
        for _ in range(900):
            key = (rng.randint(1,1000),rng.choice(names))
            if key in base:
                continue
            first = rng.randint(0,350)
            last = first+rng.randint(0,65)
            base[key] = (first,last)
        for con in (self.optimizada,self.original):
            con.executemany('INSERT INTO whosthat VALUES (?,?,?,?)',((uid,name,to_days((first_day+timedelta(days=a)).isoformat()),b-a) for (uid,name),(a,b) in base.items()))
        for seq in range(101,116):
            keys = rng.sample(list(base),min(len(base),300))
            rows = {}
            for key in keys:
                a,b = base[key]
                left = rng.choice([a,a,a-10,a+5,b])
                right = rng.choice([b,b,b+1,b+10,a])
                first,last = min(left,right),max(left,right)
                rows[key] = ((first_day+timedelta(days=first)).isoformat(),(first_day+timedelta(days=last)).isoformat())
            for _ in range(40):
                key = (rng.randint(1001,1500),rng.choice(names))
                rows[key] = ((first_day+timedelta(days=seq)).isoformat(),(first_day+timedelta(days=seq+1)).isoformat())
            incoming = [(uid,name,*bounds) for (uid,name),bounds in rows.items()]
            changes = self.apply_both(seq,incoming)
            self.assertEqual(sum(changes),len(incoming))
            for key,(a,b) in rows.items():
                left = (date.fromisoformat(a)-first_day).days
                right = (date.fromisoformat(b)-first_day).days
                if key in base:
                    old_a,old_b = base[key]
                    base[key] = min(old_a,left),max(old_b,right)
                else:
                    base[key] = left,right
if __name__ == '__main__':
    unittest.main()
