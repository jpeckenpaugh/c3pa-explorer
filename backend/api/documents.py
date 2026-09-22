import sqlite3
from fastapi import APIRouter, Depends

from backend.core.deps import get_db
from backend.services.document_service import (
    get_document_annotations,
    get_document_detail,
    get_document_html,
    get_document_rendered,
    get_documents_order,
    list_documents,
)

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.get("")
def documents(
    subset: str | None = None,
    q: str | None = None,
    sort: str | None = None,
    order: str = "asc",
    limit: int = 50,
    offset: int = 0,
    db: sqlite3.Connection = Depends(get_db),
):
    return list_documents(db, subset=subset, q=q, sort=sort, order=order, limit=limit, offset=offset)


@router.get("/order")
def documents_order(db: sqlite3.Connection = Depends(get_db)):
    return get_documents_order(db)


@router.get("/{doc_id}")
def document(doc_id: str, db: sqlite3.Connection = Depends(get_db)):
    return get_document_detail(db, doc_id)


@router.get("/{doc_id}/rendered")
def document_rendered(doc_id: str, db: sqlite3.Connection = Depends(get_db)):
    return get_document_rendered(db, doc_id)


@router.get("/{doc_id}/annotations")
def document_annotations(doc_id: str, db: sqlite3.Connection = Depends(get_db)):
    return get_document_annotations(db, doc_id)


@router.get("/{doc_id}/html")
def document_html(doc_id: str, db: sqlite3.Connection = Depends(get_db)):
    return get_document_html(db, doc_id)
