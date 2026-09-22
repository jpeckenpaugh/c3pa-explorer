import sqlite3
from fastapi import APIRouter, Depends

from backend.core.deps import get_db
from backend.schemas.units import UnitFilterParams
from backend.services.export_service import export_units, preview_export

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("")
def export(
    format: str = "csv",
    split: bool = True,
    split_train: int = 80,
    split_eval: int = 10,
    split_test: int = 10,
    seed: int = 42,
    stratify: bool = True,
    exclude_other: bool = False,
    max_doc_label_pct: float = 0,
    fields: str | None = None,
    filters: UnitFilterParams = Depends(),
    db: sqlite3.Connection = Depends(get_db),
):
    params = filters.to_dict()
    if exclude_other:
        params.setdefault("exclude_labels", [])
        if "Others" not in params["exclude_labels"]:
            params["exclude_labels"].append("Others")
    return export_units(
        db,
        params,
        format=format,
        split=split,
        split_train=split_train,
        split_eval=split_eval,
        split_test=split_test,
        seed=seed,
        stratify=stratify,
        exclude_other=exclude_other,
        max_doc_label_pct=max_doc_label_pct,
        fields=fields,
    )


@router.get("/preview")
def preview(
    format: str = "csv",
    split: bool = True,
    split_train: int = 80,
    split_eval: int = 10,
    split_test: int = 10,
    seed: int = 42,
    stratify: bool = True,
    exclude_other: bool = False,
    max_doc_label_pct: float = 0,
    fields: str | None = None,
    filters: UnitFilterParams = Depends(),
    db: sqlite3.Connection = Depends(get_db),
):
    params = filters.to_dict()
    if exclude_other:
        params.setdefault("exclude_labels", [])
        if "Others" not in params["exclude_labels"]:
            params["exclude_labels"].append("Others")
    return preview_export(
        db,
        params,
        format=format,
        split=split,
        split_train=split_train,
        split_eval=split_eval,
        split_test=split_test,
        seed=seed,
        stratify=stratify,
        exclude_other=exclude_other,
        max_doc_label_pct=max_doc_label_pct,
        fields=fields,
    )

