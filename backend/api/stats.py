import sqlite3
from fastapi import APIRouter, Depends

from backend.core.deps import get_db
from backend.services.stats_service import get_fragment_types_data, get_labels_data, get_stats_data

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats")
def stats(
    evidence_threshold: int = 1,
    ranumbs: str | None = None,
    db: sqlite3.Connection = Depends(get_db),
):
    return get_stats_data(db, evidence_threshold=evidence_threshold, ranumbs=ranumbs)


@router.get("/labels")
def labels(db: sqlite3.Connection = Depends(get_db)):
    return get_labels_data(db)


@router.get("/fragment-types")
def fragment_types(db: sqlite3.Connection = Depends(get_db)):
    return get_fragment_types_data(db)
