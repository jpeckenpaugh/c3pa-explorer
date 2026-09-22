import sqlite3
from typing import Generator

from backend.db import connect


def get_db() -> Generator[sqlite3.Connection, None, None]:
    """FastAPI dependency yielding an open SQLite database connection.

    Guarantees the connection is closed after the request lifecycle finishes.
    """
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
