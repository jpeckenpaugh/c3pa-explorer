import sqlite3
from backend.services.unit_service import decorate_unit


def global_search(conn: sqlite3.Connection, q: str = "") -> dict:
    query = q.strip()
    if not query or len(query) < 2:
        return {"q": query, "documents": [], "provisions": [], "annotators": [], "units": []}

    param = f"%{query}%"

    # 1. Documents (match doc_id, title, or link)
    doc_rows = conn.execute(
        """SELECT doc_id, title, link 
           FROM documents 
           WHERE doc_id LIKE ? OR title LIKE ? OR link LIKE ? 
           LIMIT 5""",
        (param, param, param)
    ).fetchall()
    documents = [dict(r) for r in doc_rows]

    # 2. Provisions / Legal Labels (match label)
    prov_rows = conn.execute(
        """SELECT label, COUNT(*) as count 
           FROM annotations 
           WHERE label LIKE ? 
           GROUP BY label 
           ORDER BY count DESC 
           LIMIT 5""",
        (param,)
    ).fetchall()
    provisions = [dict(r) for r in prov_rows]

    # 3. Annotators (match ranumb e.g. ra1, ra2)
    ann_rows = conn.execute(
        """SELECT ranumb, COUNT(*) as count, COUNT(DISTINCT doc_id) as docs 
           FROM annotations 
           WHERE ranumb LIKE ? 
           GROUP BY ranumb 
           LIMIT 5""",
        (param,)
    ).fetchall()
    annotators = [dict(r) for r in ann_rows]

    # 4. Text Units & Samples (match unit_text)
    unit_rows = conn.execute(
        """SELECT u.unit_id, u.doc_id, u.unit_text, u.unit_kind, u.fragment_type, u.label_category, u.position, u.block_kind,
                  (SELECT group_concat(sl.label, ';') FROM unit_labels sl WHERE sl.unit_id = u.unit_id ORDER BY sl.label) AS verbatim_labels
           FROM text_units u
           JOIN documents d ON d.doc_id = u.doc_id
           WHERE u.unit_text LIKE ?
           LIMIT 6""",
        (param,)
    ).fetchall()
    units = [decorate_unit(dict(r)) for r in unit_rows]

    return {
        "q": query,
        "documents": documents,
        "provisions": provisions,
        "annotators": annotators,
        "units": units,
    }
