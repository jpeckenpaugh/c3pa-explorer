import os
import sqlite3
from fastapi import HTTPException

from backend.core.config import ROOT


def list_documents(
    conn: sqlite3.Connection,
    subset: str | None = None,
    q: str | None = None,
    sort: str | None = None,
    order: str = "asc",
    limit: int = 50,
    offset: int = 0,
) -> dict:
    where, args = [], []
    if subset:
        where.append("d.subset = ?")
        args.append(subset)
    if q:
        where.append("(d.link LIKE ? OR d.doc_id LIKE ?)")
        args += [f"%{q}%", f"%{q}%"]
    w = (" WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(f"SELECT COUNT(*) n FROM documents d{w}", args).fetchone()["n"]

    order_dir = "DESC" if order.lower() == "desc" else "ASC"
    if sort in ("sentence_count", "sentences"):
        order_clause = f"ORDER BY sentence_count {order_dir}, d.subset, d.num"
    elif sort in ("fragment_count", "fragments"):
        order_clause = f"ORDER BY fragment_count {order_dir}, d.subset, d.num"
    elif sort in ("annotation_count", "annotations"):
        order_clause = f"ORDER BY annotation_count {order_dir}, d.subset, d.num"
    elif sort in ("doc_id", "id"):
        order_clause = f"ORDER BY d.subset {order_dir}, d.num {order_dir}"
    else:
        order_clause = "ORDER BY d.subset, d.num"

    rows = conn.execute(
        f"""SELECT d.doc_id, d.subset, d.num, d.title, d.link, d.is_homepage,
                   (SELECT COUNT(*) FROM text_units u WHERE u.doc_id = d.doc_id AND u.unit_kind = 'sentence') AS sentence_count,
                   (SELECT COUNT(*) FROM text_units u WHERE u.doc_id = d.doc_id AND u.unit_kind = 'fragment') AS fragment_count,
                   (SELECT COUNT(*) FROM annotations a WHERE a.doc_id = d.doc_id) AS annotation_count,
                   (SELECT COUNT(DISTINCT a.label) FROM annotations a WHERE a.doc_id = d.doc_id) AS label_count,
                   (SELECT COUNT(*) FROM annotations a WHERE a.doc_id = d.doc_id AND a.status = 'aligned') AS aligned_count
            FROM documents d{w} {order_clause} LIMIT ? OFFSET ?""",
        args + [limit, offset],
    ).fetchall()
    return {"total": total, "rows": [dict(r) for r in rows]}


def get_documents_order(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("SELECT doc_id FROM documents ORDER BY subset, num").fetchall()
    return {"order": [r["doc_id"] for r in rows]}


def get_document_detail(conn: sqlite3.Connection, doc_id: str) -> dict:
    doc = conn.execute("SELECT * FROM documents WHERE doc_id=?", (doc_id,)).fetchone()
    if not doc:
        raise HTTPException(404, f"unknown document {doc_id}")
    annotations = [dict(r) for r in conn.execute(
        "SELECT * FROM annotations WHERE doc_id=? ORDER BY src_row", (doc_id,))]
    units = [dict(r) for r in conn.execute(
        """SELECT u.*,
                  (SELECT group_concat(sl.label, ';') FROM unit_labels sl
                    WHERE sl.unit_id = u.unit_id ORDER BY sl.label) AS verbatim_labels
           FROM text_units u WHERE u.doc_id=? ORDER BY u.position""", (doc_id,))]
    for u in units:
        u["labels"] = [l for l in (u["verbatim_labels"] or "").split(";") if l]
    return {"document": dict(doc), "annotations": annotations, "units": units}


def get_document_rendered(conn: sqlite3.Connection, doc_id: str) -> dict:
    doc = conn.execute("SELECT * FROM documents WHERE doc_id=?", (doc_id,)).fetchone()
    if not doc:
        raise HTTPException(404, f"unknown document {doc_id}")
    rows = conn.execute(
        """SELECT u.unit_id, u.position, u.block_seq, u.block_kind, u.unit_text,
                  u.unit_kind, u.fragment_type, u.label_category, u.annotator_count,
                  (SELECT group_concat(sl.label, ';') FROM unit_labels sl
                    WHERE sl.unit_id = u.unit_id ORDER BY sl.label) AS verbatim_labels
           FROM text_units u WHERE u.doc_id=? ORDER BY u.block_seq, u.position""",
        (doc_id,)).fetchall()
    blocks = []
    for r in rows:
        if not blocks or blocks[-1]["seq"] != r["block_seq"]:
            blocks.append({"seq": r["block_seq"], "kind": r["block_kind"], "units": []})
        u = dict(r)
        u["labels"] = [l for l in (u["verbatim_labels"] or "").split(";") if l]
        blocks[-1]["units"].append(u)
    return {"doc_id": doc_id, "document": dict(doc), "blocks": blocks}


def get_document_annotations(conn: sqlite3.Connection, doc_id: str) -> dict:
    if not conn.execute("SELECT 1 FROM documents WHERE doc_id=?", (doc_id,)).fetchone():
        raise HTTPException(404, f"unknown document {doc_id}")
    rows = conn.execute(
        """SELECT a.annotation_id, a.src_row, a.ranumb, a.text, a.label, a.status,
                  (SELECT group_concat(g.unit_id, ';') FROM alignment g
                    WHERE g.annotation_id = a.annotation_id) AS unit_ids
           FROM annotations a WHERE a.doc_id=? ORDER BY a.src_row""", (doc_id,)).fetchall()
    anns = []
    for r in rows:
        d = dict(r)
        d["unit_ids"] = [u for u in (d["unit_ids"] or "").split(";") if u]
        anns.append(d)
    return {"doc_id": doc_id, "annotations": anns}


def get_document_html(conn: sqlite3.Connection, doc_id: str) -> dict:
    doc = conn.execute("SELECT html_path FROM documents WHERE doc_id=?", (doc_id,)).fetchone()
    if not doc:
        raise HTTPException(404, f"unknown document {doc_id}")
    path = os.path.join(ROOT, doc["html_path"]) if not os.path.isabs(doc["html_path"]) else doc["html_path"]
    if not os.path.exists(path):
        raise HTTPException(404, f"html file not found: {path}")
    from backend.extract import extract_blocks
    with open(path, encoding="utf-8", errors="replace") as f:
        blocks = extract_blocks(f.read())
    text = "\n".join(b["text"] for b in blocks)
    return {"doc_id": doc_id, "text": text}
