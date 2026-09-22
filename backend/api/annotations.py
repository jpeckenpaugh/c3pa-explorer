import sqlite3
from fastapi import APIRouter, Depends

from backend.core.deps import get_db
from backend.services.annotation_service import get_annotation_detail, list_annotations

router = APIRouter(prefix="/api/annotations", tags=["annotations"])


@router.get("")
def annotations(
    doc_id: str | None = None,
    ranumb: str | None = None,
    label: str | None = None,
    labels: str | None = None,
    exclude_labels: str | None = None,
    status: str | None = None,
    limit: int = 100,
    offset: int = 0,
    db: sqlite3.Connection = Depends(get_db),
):
    return list_annotations(
        db,
        doc_id=doc_id,
        ranumb=ranumb,
        label=label,
        labels=labels,
        exclude_labels=exclude_labels,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.get("/{annotation_id}")
def annotation_detail(annotation_id: int, db: sqlite3.Connection = Depends(get_db)):
    return get_annotation_detail(db, annotation_id)
