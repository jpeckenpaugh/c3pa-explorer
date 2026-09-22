import sqlite3
from backend.db import unit_support


def get_stats_data(conn: sqlite3.Connection, evidence_threshold: int = 1, ranumbs: str | None = None) -> dict:
    def one(sql, params=()):
        return conn.execute(sql, params).fetchone()[0]

    ra_list = [r.strip() for r in ranumbs.split(",") if r.strip()] if ranumbs is not None else None
    if ra_list is not None:
        if ra_list:
            ph = ",".join("?" for _ in ra_list)
            where_ann = f"WHERE ranumb IN ({ph})"
            and_ann = f"AND ranumb IN ({ph})"
            ann_args = list(ra_list)
        else:
            where_ann = "WHERE 1=0"
            and_ann = "AND 1=0"
            ann_args = []
    else:
        where_ann = ""
        and_ann = ""
        ann_args = []

    cats = {r["label_category"]: r["n"] for r in conn.execute(
        "SELECT label_category, COUNT(*) n FROM text_units WHERE unit_kind='sentence' GROUP BY label_category")}
    kinds = {r["unit_kind"]: r["n"] for r in conn.execute(
        "SELECT unit_kind, COUNT(*) n FROM text_units GROUP BY unit_kind")}
    frags = {r["fragment_type"]: r["n"] for r in conn.execute(
        "SELECT fragment_type, COUNT(*) n FROM text_units WHERE unit_kind='fragment' GROUP BY fragment_type")}
    label_dist = [{"label": r["label"], "count": r["n"], "single_label_count": r["s"]}
                  for r in conn.execute(
                      """SELECT ul.label,
                                 COUNT(DISTINCT ul.unit_id) n,
                                 SUM(CASE WHEN u.label_category='single_label' THEN 1 ELSE 0 END) s
                          FROM unit_labels ul JOIN text_units u ON u.unit_id = ul.unit_id
                          GROUP BY ul.label ORDER BY n DESC""")]
    annotators = [dict(r) for r in conn.execute(
        """SELECT ranumb, COUNT(*) n,
                  COUNT(DISTINCT doc_id) docs,
                  COUNT(DISTINCT label) labels
           FROM annotations GROUP BY ranumb ORDER BY ranumb""")]
    counts = {
        "documents": one("SELECT COUNT(*) FROM documents"),
        "units": one("SELECT COUNT(*) FROM text_units"),
        "sentences": kinds.get("sentence", 0),
        "fragments": kinds.get("fragment", 0),
        "annotations": one(f"SELECT COUNT(*) FROM annotations {where_ann}", ann_args),
        "aligned": one(f"SELECT COUNT(*) FROM annotations WHERE status='aligned' {and_ann}", ann_args),
        "unmatched": one(f"SELECT COUNT(*) FROM annotations WHERE status='unmatched' {and_ann}", ann_args),
        "ambiguous": one(f"SELECT COUNT(*) FROM annotations WHERE status='ambiguous' {and_ann}", ann_args),
        "single_label_sentences": cats.get("single_label", 0),
        "multi_label_sentences": cats.get("multi_label", 0),
        "unlabeled_sentences": cats.get("unlabeled", 0),
        "high_confidence_single": one(
            "SELECT COUNT(*) FROM text_units WHERE label_category='single_label' AND annotator_count>=2"),
        "subsets": {r["subset"]: r["n"] for r in
                    conn.execute("SELECT subset, COUNT(*) n FROM documents GROUP BY subset")},
        "fragment_distribution": frags,
    }
    ann_label_dist = [
        {"label": r["label"], "count": r["n"]} for r in conn.execute(
            f"SELECT label, COUNT(*) n FROM annotations {where_ann} GROUP BY label ORDER BY label", ann_args)]

    support = unit_support(conn, evidence_threshold)
    cat = {r["unit_id"]: r["label_category"] for r in conn.execute(
        "SELECT unit_id, label_category FROM text_units "
        "WHERE label_category IN ('single_label', 'multi_label')")}
    single_stars = {1: 0, 2: 0, 3: 0}
    multi_stars = {1: 0, 2: 0, 3: 0}
    for unit_id, pairs in support.items():
        if cat.get(unit_id) == "single_label":
            single_stars[pairs[0]["stars"]] += 1
        elif cat.get(unit_id) == "multi_label":
            multi_stars[max(p["stars"] for p in pairs)] += 1

    aligned_by_label = {r["label"]: r["n"] for r in conn.execute(f"SELECT label, COUNT(*) n FROM annotations WHERE status='aligned' {and_ann} GROUP BY label", ann_args)}
    unmatched_by_label = {r["label"]: r["n"] for r in conn.execute(f"SELECT label, COUNT(*) n FROM annotations WHERE status='unmatched' {and_ann} GROUP BY label", ann_args)}
    ambiguous_by_label = {r["label"]: r["n"] for r in conn.execute(f"SELECT label, COUNT(*) n FROM annotations WHERE status='ambiguous' {and_ann} GROUP BY label", ann_args)}
    hits_by_label = {r["label"]: r["n"] for r in conn.execute("SELECT ul.label, COUNT(DISTINCT ul.unit_id) n FROM unit_labels ul JOIN text_units u ON u.unit_id = ul.unit_id WHERE u.label_category IN ('single_label', 'multi_label') GROUP BY ul.label")}

    return {
        **counts,
        "label_distribution": label_dist,
        "annotation_label_distribution": ann_label_dist,
        "aligned_by_label": aligned_by_label,
        "unmatched_by_label": unmatched_by_label,
        "ambiguous_by_label": ambiguous_by_label,
        "hits_by_label": hits_by_label,
        "single_label_stars": single_stars,
        "multi_label_stars": multi_stars,
        "annotators": annotators,
    }


def get_labels_data(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """SELECT label, COUNT(DISTINCT unit_id) unit_count
           FROM unit_labels GROUP BY label ORDER BY unit_count DESC""").fetchall()
    return [dict(r) for r in rows]


def get_fragment_types_data(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """SELECT fragment_type, COUNT(*) n FROM text_units
           WHERE unit_kind='fragment' AND fragment_type IS NOT NULL
           GROUP BY fragment_type ORDER BY n DESC""").fetchall()
    return [dict(r) for r in rows]
