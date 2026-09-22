from typing import Literal
from pydantic import BaseModel, Field


def parse_labels(raw: str | list[str] | None) -> list[str]:
    """Parse comma-separated string or list of labels into a clean list of strings."""
    if not raw:
        return []
    if isinstance(raw, list):
        out = []
        for item in raw:
            out.extend([l.strip() for l in item.split(",") if l.strip()])
        return out
    return [l.strip() for l in raw.split(",") if l.strip()]


class UnitFilterParams(BaseModel):
    subset: str | None = None
    doc_id: str | None = None
    category: str | None = None
    unit_kind: str | None = None
    fragment_type: str | None = None
    labels: str | None = None
    exclude_labels: str | None = None
    min_annotators: int | None = None
    high_confidence: bool = False
    q: str | None = None
    sample_view: str | None = None
    evidence_threshold: int = 1
    min_support: int = 1
    support_mode: str = "at_least"

    def to_dict(self) -> dict:
        """Converts to dictionary format compatible with backend.db.build_unit_filter."""
        return {
            "subset": self.subset,
            "doc_id": self.doc_id,
            "category": self.category,
            "unit_kind": self.unit_kind,
            "fragment_type": self.fragment_type,
            "labels": parse_labels(self.labels),
            "exclude_labels": parse_labels(self.exclude_labels),
            "min_annotators": self.min_annotators,
            "high_confidence": self.high_confidence,
            "q": self.q,
            "sample_view": parse_labels(self.sample_view),
            "evidence_threshold": self.evidence_threshold,
            "min_support": self.min_support,
            "support_mode": self.support_mode,
        }
