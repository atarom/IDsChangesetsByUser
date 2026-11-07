from pathlib import Path
import sqlite3
from formato_fechas import assert_data_ranges, validate_schema
def optimize_if_needed(source: Path, destination: Path) -> Path:
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve():
        raise ValueError('El destino debe ser distinto del origen')
    with sqlite3.connect(f'file:{source.resolve()}?mode=ro', uri=True) as con:
        validate_schema(con, integrity=True)
        indexes = con.execute("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_autoindex_%'").fetchall()
        if indexes:
            raise ValueError('No se admiten índices secundarios en el formato exclusivo v2')
        assert_data_ranges(con)
    print('Formato v2 óptimo: WITHOUT ROWID y fechas relativas, sin índices secundarios.', flush=True)
    return source
