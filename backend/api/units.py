import sqlite3
from fastapi import APIRouter, Depends

from backend.core.deps import get_db
from backend.schemas.units import UnitFilterParams
from backend.services.unit_service import get_unit_alignment, get_units_data

router = APIRouter(prefix="/api", tags=["units"])


@router.get("/units")
def units(
    limit: int = 50,
    offset: int = 0,
    filters: UnitFilterParams = Depends(),
    db: sqlite3.Connection = Depends(get_db),
):
    params = filters.to_dict()
    return get_units_data(db, params, limit=limit, offset=offset)


@router.get("/alignment")
def alignment(unit_id: str, db: sqlite3.Connection = Depends(get_db)):
    return get_unit_alignment(db, unit_id)
