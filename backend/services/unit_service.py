import sqlite3
from backend.db import UNIT_SELECT, build_unit_filter, unit_support


def decorate_unit(r: dict) -> dict:
    if "unit_text" in r and "text" not in r:
        r["text"] = r["unit_text"]
    labels = [l for l in r["verbatim_labels"].split(";") if l] if r.get("verbatim_labels") else []
    if r.get("label_category") == "single_label" and len(labels) == 1:
        r["verbatim_label"] = labels[0]
    elif r.get("label_category") == "multi_label":
        r["verbatim_label"] = "MULTI_LABEL"
    else:
        r["verbatim_label"] = ""
    return r


def unit_rows(conn: sqlite3.Connection, params: dict, limit: int | None = None, offset: int = 0) -> tuple[list[dict], int]:
    where, args = build_unit_filter(params)
    count_sql = ("SELECT COUNT(*) AS n FROM text_units u JOIN documents d ON d.doc_id = u.doc_id"
                 + where)
    total = conn.execute(count_sql, args).fetchone()["n"]

    sql = UNIT_SELECT + where + " ORDER BY u.doc_id, u.position"
    if limit is not None:
        sql += " LIMIT ? OFFSET ?"
        args = args + [limit, offset]
    rows = [decorate_unit(dict(r)) for r in conn.execute(sql, args).fetchall()]
    return rows, total


def get_units_data(conn: sqlite3.Connection, params: dict, limit: int = 50, offset: int = 0) -> dict:
    evidence_threshold = params.get("evidence_threshold", 1)
    support = unit_support(conn, evidence_threshold)
    rows, total = unit_rows(conn, params, limit, offset)
    for r in rows:
        r["support"] = support.get(r["unit_id"], [])
    return {"total": total, "rows": rows}


def get_unit_alignment(conn: sqlite3.Connection, unit_id: str) -> dict:
    rows = conn.execute(
        """SELECT a.annotation_id, a.ranumb, a.text, a.label, g.alignment_type
           FROM alignment g JOIN annotations a ON a.annotation_id = g.annotation_id
           WHERE g.unit_id=? ORDER BY a.ranumb, g.alignment_type""",
        (unit_id,)).fetchall()
    return {"unit_id": unit_id, "rows": [dict(r) for r in rows]}
