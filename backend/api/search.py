import sqlite3
from fastapi import APIRouter, Depends

from backend.core.deps import get_db
from backend.services.search_service import global_search

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(q: str = "", db: sqlite3.Connection = Depends(get_db)):
    return global_search(db, q=q)
