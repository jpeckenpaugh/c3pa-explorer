import sqlite3
from fastapi import HTTPException
from backend.schemas.units import parse_labels


def list_annotations(
    conn: sqlite3.Connection,
    doc_id: str | None = None,
    ranumb: str | None = None,
    label: str | None = None,
    labels: str | None = None,
    exclude_labels: str | None = None,
    status: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    where, args = [], []
    for col, val in (("doc_id", doc_id), ("ranumb", ranumb if ranumb != "all" else None), ("status", status)):
        if val:
            where.append(f"{col} = ?")
            args.append(val)
    if label:
        where.append("label = ?")
        args.append(label)
    labels_list = parse_labels(labels)
    if labels_list:
        placeholders = ",".join("?" for _ in labels_list)
        where.append(f"label IN ({placeholders})")
        args.extend(labels_list)
    excluded = parse_labels(exclude_labels)
    if excluded:
        placeholders = ",".join("?" for _ in excluded)
        where.append(f"label NOT IN ({placeholders})")
        args.extend(excluded)
    w = (" WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(f"SELECT COUNT(*) n FROM annotations a{w}", args).fetchone()["n"]
    rows = conn.execute(
        f"SELECT * FROM annotations a{w} ORDER BY a.doc_id, a.src_row LIMIT ? OFFSET ?",
        args + [limit, offset]).fetchall()
    return {"total": total, "rows": [dict(r) for r in rows]}


def get_annotation_detail(conn: sqlite3.Connection, annotation_id: int) -> dict:
    ann = conn.execute("SELECT * FROM annotations WHERE annotation_id=?", (annotation_id,)).fetchone()
    if not ann:
        raise HTTPException(404, f"unknown annotation {annotation_id}")
    d = dict(ann)
    units = [dict(r) for r in conn.execute(
        """SELECT u.unit_id, u.unit_text, u.unit_kind, u.fragment_type, u.label_category, g.alignment_type
           FROM alignment g JOIN text_units u ON u.unit_id = g.unit_id
           WHERE g.annotation_id=? ORDER BY u.position""", (annotation_id,)).fetchall()]
    d["aligned_units"] = units
    return d
