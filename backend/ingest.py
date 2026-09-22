#!/usr/bin/env python3
"""Builds the normalized SQLite database for the C3PA Explorer.

Source layer: documents + annotations, verbatim from the C3PA dataset repo
(cloned into the submodule on first run).
Derived layer: text units re-extracted deterministically (backend/extract.py) and
annotations re-aligned to them, so every derived label is auditable.

Usage:
    python -m backend.ingest [--dataset-dir DIR] [--db PATH] [--max-docs N]
"""

import argparse
import csv
import glob
import os

from backend.db import connect, init_db
from backend.extract import align_annotations, extract_title, extract_units, load_annotations

APP_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(APP_DIR)
DEFAULT_DATASET = os.path.join(ROOT, "c3pa-sentence-label-parser", "C3PA_Dataset")
C3PA_REPO = "https://github.com/MaazBinMusa/C3PA_Dataset.git"


def ensure_dataset(dataset_dir: str) -> str:
    if not os.path.exists(os.path.join(dataset_dir, "Htmls")):
        if not os.path.exists(dataset_dir):
            os.makedirs(dataset_dir, exist_ok=True)
        print(f"[ingest] C3PA dataset not found; cloning into {dataset_dir} ...")
        os.system(f"git clone --depth 1 {C3PA_REPO} {dataset_dir}")
    return dataset_dir


def load_crawl_meta(dataset_dir: str, subset: str) -> dict[int, dict]:
    """Loads Crawl metadata for a subset. The repo ships one file per subset
    ('Crawl/db.csv', 'Crawl/ws.csv'); row i (after header) == doc number i+1."""
    meta = {}
    for path in glob.glob(os.path.join(dataset_dir, "Crawl", f"*{subset.lower()}*.csv")) \
            or glob.glob(os.path.join(dataset_dir, "Crawl", f"*{subset}*.csv")):
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                meta[i + 1] = {
                    "link": (row.get("Link") or "").strip(),
                    "is_homepage": (row.get("IsHomepage") or "").strip(),
                    "textmatch_p": (row.get("Textmatch_P") or "").strip(),
                    "textmatch_s": (row.get("Textmatch_S") or "").strip(),
                    "textmatch_pp": (row.get("Textmatch_PP") or "").strip(),
                    "link_match": (row.get("Link_Match") or "").strip(),
                    "crawl_path": path,
                }
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset-dir", default=DEFAULT_DATASET)
    ap.add_argument("--db", default=os.path.join(APP_DIR, "..", "data", "explorer.db"))
    ap.add_argument("--max-docs", type=int, default=None,
                    help="Limit to first N documents (for quick POC builds)")
    args = ap.parse_args()

    dataset_dir = os.path.abspath(args.dataset_dir)
    db_path = os.path.abspath(args.db)
    ensure_dataset(dataset_dir)

    import backend.db as dbmod

    dbmod.DB_PATH = db_path
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = connect()
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys = OFF")
    # drop app tables first (schema may have changed between builds)
    for t in ("alignment", "unit_labels", "text_units", "annotations", "documents",
              "sentence_labels", "sentences", "annotations_unmatched", "annotations_ambiguous"):
        cur.execute(f"DROP TABLE IF EXISTS {t}")
    cur.execute("PRAGMA foreign_keys = ON")
    init_db(conn)

    stats = {"docs": 0, "units": 0, "sentences": 0, "fragments": 0,
             "annotations": 0, "aligned": 0, "unmatched": 0, "ambiguous": 0,
             "single": 0, "multi": 0, "unlabeled": 0, "high_conf": 0}

    doc_pairs = []
    for subset in ("DB", "WS"):
        ann_dir = os.path.join(dataset_dir, "Annotations", subset)
        html_dir = os.path.join(dataset_dir, "Htmls", subset)
        if not (os.path.isdir(ann_dir) and os.path.isdir(html_dir)):
            continue
        crawl = load_crawl_meta(dataset_dir, subset)
        for csv_path in sorted(glob.glob(os.path.join(ann_dir, "*.csv"))):
            num = os.path.splitext(os.path.basename(csv_path))[0]
            html_path = os.path.join(html_dir, f"{num}.html")
            if not os.path.exists(html_path):
                continue
            doc_pairs.append((f"{subset}_{num}", subset, int(num), html_path, csv_path, crawl))

    if args.max_docs:
        doc_pairs = doc_pairs[: args.max_docs]
    print(f"[ingest] processing {len(doc_pairs)} documents ...")

    for doc_id, subset, num, html_path, csv_path, crawl in doc_pairs:
        crawl_meta = crawl.get(num, {})
        # derived: extract units deterministically
        with open(html_path, encoding="utf-8", errors="replace") as f:
            html = f.read()
        cur.execute(
            """INSERT INTO documents (doc_id, subset, num, title, link, is_homepage,
               textmatch_p, textmatch_s, textmatch_pp, link_match, html_path, crawl_path)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (doc_id, subset, num, extract_title(html),
             crawl_meta.get("link"), crawl_meta.get("is_homepage"),
             crawl_meta.get("textmatch_p"), crawl_meta.get("textmatch_s"),
             crawl_meta.get("textmatch_pp"), crawl_meta.get("link_match"),
             html_path, crawl_meta.get("crawl_path")),
        )

        raw_units = extract_units(html)
        units = []
        for i, u in enumerate(raw_units, start=1):
            units.append({**u, "id": f"{doc_id}_U{i}", "doc_id": doc_id, "position": i})
            cur.execute(
                """INSERT INTO text_units (unit_id, doc_id, position, block_seq, block_kind,
                   unit_text, unit_kind, fragment_type, label_category, annotator_count,
                   source_annotation_count, alignment_types)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (units[-1]["id"], doc_id, i, u["block_seq"], u["block_kind"],
                 u["text"], u["unit_kind"], u["fragment_type"],
                 # initial category: sentences start 'unlabeled' (measurement-
                 # relative -- no annotation signal yet); fragments are
                 # 'not-eligible' by design (see note in backend/db.py)
                 "unlabeled" if u["unit_kind"] == "sentence" else "not-eligible",
                 0, 0, None),
            )
            stats["units"] += 1
            stats["sentences" if u["unit_kind"] == "sentence" else "fragments"] += 1

        # source: annotations (verbatim)
        annotations = load_annotations(csv_path)
        ann_id_by_src = {}
        for ann in annotations:
            cur.execute(
                """INSERT INTO annotations (doc_id, ranumb, text, label, status, src_row, source_csv)
                   VALUES (?,?,?,?,?,?,?)""",
                (doc_id, ann["ranumb"], ann["text"], ann["label"], "aligned",
                 ann["src_row"], ann["source_csv"]),
            )
            ann_id_by_src[ann["src_row"]] = cur.lastrowid
            stats["annotations"] += 1

        # derived: align annotations to units (3-tier, deterministic)
        aligned, unmatched, ambiguous = align_annotations(units, annotations)

        for ann in unmatched:
            cur.execute(
                "UPDATE annotations SET status='unmatched' WHERE doc_id=? AND src_row=?",
                (doc_id, ann["src_row"]),
            )
            stats["unmatched"] += 1
        for ann, unit_ids in ambiguous:
            cur.execute(
                "UPDATE annotations SET status='ambiguous', matched_units=? WHERE doc_id=? AND src_row=?",
                (";".join(unit_ids), doc_id, ann["src_row"]),
            )
            stats["ambiguous"] += 1

        # Alignment provenance is recorded for EVERY unit (sentences and
        # fragments alike) so the audit trail is complete: you can always see
        # where an annotation landed. But label categories are applied to
        # SENTENCES ONLY. The project's goal is reliable sentence/label pairs;
        # fragments are by definition not sentences, so a label on one is noise
        # for that purpose (see the note in backend/db.py). Fragment units keep the
        # distinct category 'not-eligible' with no unit_labels rows; their
        # alignments remain. 'unlabeled' sentences are measurement-relative:
        # no annotation signal for this version -- NOT label-inapplicable.
        evidence: dict[str, dict] = {}
        unit_kind = {u["id"]: u["unit_kind"] for u in units}
        for ann, unit_id, align_type in aligned:
            cur.execute(
                "INSERT INTO alignment (unit_id, annotation_id, alignment_type) VALUES (?,?,?)",
                (unit_id, ann_id_by_src[ann["src_row"]], align_type),
            )
            stats["aligned"] += 1
            if unit_kind[unit_id] != "sentence":
                continue
            ev = evidence.setdefault(unit_id, {"labels": set(), "annotators": set(),
                                               "align": set(), "count": 0})
            ev["labels"].add(ann["label"])
            ev["annotators"].add(ann["ranumb"])
            ev["align"].add(align_type)
            ev["count"] += 1

        for unit in units:
            if unit["unit_kind"] != "sentence":
                continue
            ev = evidence.get(unit["id"])
            if not ev:
                continue
            labels = sorted(ev["labels"])
            annotators = sorted(ev["annotators"])
            category = ("unlabeled" if not labels
                        else "single_label" if len(labels) == 1 else "multi_label")
            cur.execute(
                """UPDATE text_units SET label_category=?, annotator_count=?,
                   source_annotation_count=?, alignment_types=? WHERE unit_id=?""",
                (category, len(annotators), ev["count"], ";".join(sorted(ev["align"])),
                 unit["id"]),
            )
            for lbl in labels:
                cur.execute("INSERT INTO unit_labels (unit_id, label) VALUES (?,?)",
                            (unit["id"], lbl))
            stats[{"single_label": "single", "multi_label": "multi",
                   "unlabeled": "unlabeled"}[category]] += 1
            if category == "single_label" and len(annotators) >= 2:
                stats["high_conf"] += 1

        stats["docs"] += 1
        if stats["docs"] % 50 == 0:
            print(f"  ...{stats['docs']} docs done")

    # all fragments are 'not-eligible' by design; all remaining sentences are
    # 'unlabeled' (no annotation signal for this version)
    stats["unlabeled"] = stats["sentences"] - stats["single"] - stats["multi"]

    conn.commit()
    conn.close()

    print("\n" + "=" * 60)
    print(" C3PA EXPLORER DB BUILD SUMMARY")
    print("=" * 60)
    for k, v in stats.items():
        print(f"  {k:<12} {v:>9,}")
    print("=" * 60)
    print(f"DB written to {db_path}")


if __name__ == "__main__":
    main()