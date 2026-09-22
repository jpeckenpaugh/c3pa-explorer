from datetime import datetime
import io
import json
import sqlite3
import zipfile
from fastapi import HTTPException, Response

from backend.db import UNIT_FIELDS, unit_support
from backend.export import (
    apply_max_doc_label_cap,
    check_cross_split_text_overlap,
    compute_label_distribution,
    partition,
    rows_to_csv,
    rows_to_json,
)
from backend.services.unit_service import unit_rows


LABEL_TOKEN_MAP = {
    "Categories of Personal Information Collected": "CATEGORIES_OF_PERSONAL_INFORMATION_COLLECTED",
    "Categories of Personal Information Shared / Disclosed": "CATEGORIES_OF_PERSONAL_INFORMATION_SHARED_OR_DISCLOSED",
    "Categories of Personal Information Sold": "CATEGORIES_OF_PERSONAL_INFORMATION_SOLD",
    "Description of Right to Correct Information": "DESCRIPTION_OF_RIGHT_TO_CORRECT_INFORMATION",
    "Description of Right to Delete": "DESCRIPTION_OF_RIGHT_TO_DELETE",
    "Description of Right to Know PI Collected": "DESCRIPTION_OF_RIGHT_TO_KNOW_PI_COLLECTED",
    "Description of Right to Know PI sold / shared": "DESCRIPTION_OF_RIGHT_TO_KNOW_PI_SOLD_OR_SHARED",
    "Description of Right to Limit use of PI": "DESCRIPTION_OF_RIGHT_TO_LIMIT_USE_OF_PI",
    "Description of Right to Non-discrimination on exercising rights": "DESCRIPTION_OF_RIGHT_TO_NON_DISCRIMINATION",
    "Description of Right to Opt-out of sale of PI": "DESCRIPTION_OF_RIGHT_TO_OPT_OUT_OF_SALE_OF_PI",
    "Methods to exercise rights": "METHODS_TO_EXERCISE_RIGHTS",
    "Others": "OTHERS",
    "Updated Privacy Policy": "UPDATED_PRIVACY_POLICY",
}


def tokenize_label(label_str: str) -> str:
    if label_str in LABEL_TOKEN_MAP:
        return LABEL_TOKEN_MAP[label_str]
    s = label_str.replace("/", " OR ").replace("-", "_").replace(" ", "_")
    s = "".join(c for c in s if c.isalnum() or c == "_")
    return s.upper()


def compute_label_support_analysis(rows: list[dict]) -> dict:
    """Calculates label-support analysis metrics across exported rows."""
    total_rows = len(rows)
    if total_rows == 0:
        return {}

    stats: dict[str, dict] = {}

    for r in rows:
        doc_id = r.get("doc_id", "unknown")
        support_list = r.get("support") or []

        lbl = r.get("label")
        if isinstance(lbl, list):
            tokens = lbl
        elif isinstance(lbl, str) and lbl:
            tokens = [t.strip() for t in lbl.split(";") if t.strip()]
        else:
            tokens = ["UNLABELED"]

        support_by_token: dict[str, dict] = {}
        for s in support_list:
            v_lbl = s.get("label", "")
            t_lbl = tokenize_label(v_lbl)
            support_by_token[t_lbl] = s

        for t in tokens:
            st = stats.setdefault(t, {
                "count": 0,
                "docs": set(),
                "k_sum": 0,
                "ratio_sum": 0.0,
                "has_support_info_count": 0,
                "unanimous_count": 0,
                "disputed_count": 0,
            })
            st["count"] += 1
            st["docs"].add(doc_id)

            s_info = support_by_token.get(t)
            if s_info:
                k = s_info.get("k", 0)
                p = s_info.get("pool", 0)
                stars = s_info.get("stars", 1)
                st["k_sum"] += k
                if p > 0:
                    st["ratio_sum"] += k / p
                    st["has_support_info_count"] += 1
                if stars == 3:
                    st["unanimous_count"] += 1
                elif stars == 1:
                    st["disputed_count"] += 1

    out = {}
    for token, st in sorted(stats.items(), key=lambda x: x[1]["count"], reverse=True):
        cnt = st["count"]
        pct = round(cnt / total_rows * 100.0, 2)
        info_cnt = st["has_support_info_count"]
        avg_k = round(st["k_sum"] / info_cnt, 2) if info_cnt > 0 else 0.0
        mean_ratio = round(st["ratio_sum"] / info_cnt, 4) if info_cnt > 0 else 0.0

        out[token] = {
            "raw_count": cnt,
            "percentage_of_corpus": pct,
            "distinct_documents": len(st["docs"]),
            "avg_supporting_annotators": avg_k,
            "mean_agreement_rate": mean_ratio,
            "unanimous_count": st["unanimous_count"],
            "disputed_count": st["disputed_count"],
        }

    return out


def export_units(
    conn: sqlite3.Connection,
    params: dict,
    format: str = "csv",
    split: bool = True,
    split_train: int = 80,
    split_eval: int = 10,
    split_test: int = 10,
    seed: int = 42,
    stratify: bool = True,
    exclude_other: bool = False,
    max_doc_label_pct: float = 0,
    fields: str | list[str] | None = None,
) -> Response:
    if exclude_other:
        params.setdefault("exclude_labels", [])
        if "Others" not in params["exclude_labels"]:
            params["exclude_labels"].append("Others")
    rows, total = unit_rows(conn, params)
    evidence_threshold = params.get("evidence_threshold", 1)
    support = unit_support(conn, evidence_threshold)
    for r in rows:
        pairs = support.get(r.get("unit_id", ""), [])
        r["support"] = pairs
        r["support_stars"] = max((p["stars"] for p in pairs), default="")
        r["support_evidence"] = max((p["k"] for p in pairs), default="")

        # Standard ML field aliases
        r["id"] = r.get("unit_id", "")
        r["group"] = r.get("doc_id", "")
        r["text"] = r.get("unit_text") or r.get("text", "")

        v_labels_str = r.get("verbatim_labels") or ""
        raw_labels = [l.strip() for l in v_labels_str.split(";") if l.strip()]
        if not raw_labels and r.get("verbatim_label"):
            raw_labels = [r["verbatim_label"]]

        if not raw_labels:
            r["label_name"] = "Unlabeled"
            r["label"] = "UNLABELED"
        elif len(raw_labels) == 1:
            r["label_name"] = raw_labels[0]
            r["label"] = tokenize_label(raw_labels[0])
        else:
            if format == "json":
                r["label_name"] = raw_labels
                r["label"] = [tokenize_label(l) for l in raw_labels]
            else:
                r["label_name"] = "; ".join(raw_labels)
                r["label"] = "; ".join(tokenize_label(l) for l in raw_labels)

    if max_doc_label_pct > 0:
        rows, removed_count = apply_max_doc_label_cap(rows, max_doc_label_pct)
    else:
        removed_count = 0

    meta = {
        "entity": "units",
        "filters": {k: v for k, v in params.items() if v},
        "total": len(rows),
        "original_total": total,
        "format": format,
        "max_doc_label_pct": max_doc_label_pct,
        "capped_units_removed": removed_count,
    }
    unlabeled_count = sum(1 for r in rows if r["label_category"] == "unlabeled")
    fragment_count = sum(1 for r in rows if r["unit_kind"] == "fragment")
    if unlabeled_count:
        meta["unlabeled_count"] = unlabeled_count
        meta["unlabeled_note"] = (
            "'unlabeled' sentences produced no annotation signal in this "
            "annotation version (6 annotators x budget); they are NOT verified "
            "negatives and cannot be designated as label-inapplicable. Treat "
            "them as unlabeled (positive-unlabeled learning), not as a negative "
            "class.")
    if fragment_count:
        meta["fragments_note"] = (
            "fragments are not label-eligible by design; exporting them does "
            "not produce sentence/label pairs.")

    all_possible_fields = list(UNIT_FIELDS) + ["support_stars", "support_evidence", "split"]
    meta["evidence_threshold"] = evidence_threshold
    meta["min_support"] = params.get("min_support", 1)
    meta["support_mode"] = params.get("support_mode", "at_least")

    if split:
        if split_train + split_eval + split_test != 100:
            raise HTTPException(400, "split_train + split_eval + split_test must equal 100")
        rows = partition(rows, split_train, split_eval, split_test, seed, stratify)
        meta["split"] = {"train": split_train, "eval": split_eval, "test": split_test,
                         "seed": seed, "stratify": stratify, "grouped_by": "doc_id"}
        meta["grouping_note"] = (
            "Partitions are strictly grouped by document (doc_id) to prevent data leakage "
            "across train/eval/test splits.")
    else:
        for r in rows:
            r["split"] = "data"

    meta["label_distribution"] = compute_label_distribution(rows)
    meta["label_support_analysis"] = compute_label_support_analysis(rows)
    meta["cross_split_text_overlap"] = check_cross_split_text_overlap(rows)

    default_fieldnames = ["id", "doc_id", "text", "label", "label_name", "split"]
    if fields:
        if isinstance(fields, str):
            requested_fields = [f.strip() for f in fields.split(",") if f.strip()]
        else:
            requested_fields = list(fields)

        fieldnames = [f for f in requested_fields if f in all_possible_fields]
    else:
        fieldnames = default_fieldnames


    meta["selected_fields"] = fieldnames

    now = datetime.now()
    meta["created_at"] = now.isoformat()
    timestamp_str = now.strftime("%Y-%m-%d-%H-%M")

    data_files: dict[str, str] = {}

    if split:
        split_rows: dict[str, list[dict]] = {"train": [], "eval": [], "test": []}
        for r in rows:
            s_name = r.get("split", "train")
            split_rows.setdefault(s_name, []).append(r)

        meta["counts"] = {k: len(v) for k, v in split_rows.items()}

        for s_name, s_items in split_rows.items():
            if not s_items:
                continue
            count = len(s_items)
            ext = "json" if format == "json" else "csv"
            fname = f"{s_name}_{count}.{ext}"

            filtered_items = [{k: r[k] for k in fieldnames if k in r} for r in s_items]
            if format == "json":
                content = json.dumps(filtered_items, indent=2, ensure_ascii=False)
            else:
                content = rows_to_csv(filtered_items, fieldnames)
            data_files[fname] = content
    else:
        meta["counts"] = {"total": total}
        count = len(rows)
        ext = "json" if format == "json" else "csv"
        fname = f"data_{count}.{ext}"
        filtered_items = [{k: r[k] for k in fieldnames if k in r} for r in rows]
        if format == "json":
            content = json.dumps(filtered_items, indent=2, ensure_ascii=False)
        else:
            content = rows_to_csv(filtered_items, fieldnames)
        data_files[fname] = content


    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("meta.json", json.dumps(meta, indent=2, ensure_ascii=False))
        for fname, content in data_files.items():
            zf.writestr(fname, content)

    zip_filename = f"c3pa_export_{timestamp_str}.zip"
    return Response(
        zip_buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'},
    )


def preview_export(
    conn: sqlite3.Connection,
    params: dict,
    format: str = "csv",
    split: bool = True,
    split_train: int = 80,
    split_eval: int = 10,
    split_test: int = 10,
    seed: int = 42,
    stratify: bool = True,
    exclude_other: bool = False,
    max_doc_label_pct: float = 0,
    fields: str | list[str] | None = None,
) -> dict:
    if exclude_other:
        params.setdefault("exclude_labels", [])
        if "Others" not in params["exclude_labels"]:
            params["exclude_labels"].append("Others")
    warnings = []
    if split and (split_train + split_eval + split_test != 100):
        return {
            "valid": False,
            "error": "split_train + split_eval + split_test must equal 100",
            "warnings": ["Partition ratios must sum to 100%."],
        }

    rows, total = unit_rows(conn, params)
    if not rows:
        return {
            "valid": False,
            "error": "No units match the selected filter criteria.",
            "total_units": 0,
            "counts": {},
            "warnings": ["Current filter settings returned 0 units."],
        }

    evidence_threshold = params.get("evidence_threshold", 1)
    support = unit_support(conn, evidence_threshold)
    for r in rows:
        pairs = support.get(r.get("unit_id", ""), [])
        r["support"] = pairs

        r["id"] = r.get("unit_id", "")
        r["group"] = r.get("doc_id", "")
        r["text"] = r.get("unit_text") or r.get("text", "")

        v_labels_str = r.get("verbatim_labels") or ""
        raw_labels = [l.strip() for l in v_labels_str.split(";") if l.strip()]
        if not raw_labels and r.get("verbatim_label"):
            raw_labels = [r["verbatim_label"]]

        if not raw_labels:
            r["label_name"] = "Unlabeled"
            r["label"] = "UNLABELED"
        elif len(raw_labels) == 1:
            r["label_name"] = raw_labels[0]
            r["label"] = tokenize_label(raw_labels[0])
        else:
            if format == "json":
                r["label_name"] = raw_labels
                r["label"] = [tokenize_label(l) for l in raw_labels]
            else:
                r["label_name"] = "; ".join(raw_labels)
                r["label"] = "; ".join(tokenize_label(l) for l in raw_labels)

    original_total = len(rows)
    if max_doc_label_pct > 0:
        rows, removed_count = apply_max_doc_label_cap(rows, max_doc_label_pct)
    else:
        removed_count = 0

    counts = {}
    if split:
        rows = partition(rows, split_train, split_eval, split_test, seed, stratify)
        split_rows: dict[str, int] = {"train": 0, "eval": 0, "test": 0}
        for r in rows:
            s_name = r.get("split", "train")
            split_rows[s_name] = split_rows.get(s_name, 0) + 1

        counts = {k: v for k, v in split_rows.items() if v > 0}


        for s_name, pct in [("train", split_train), ("eval", split_eval), ("test", split_test)]:
            if pct > 0 and split_rows.get(s_name, 0) == 0:
                warnings.append(f"Split '{s_name}' yielded 0 units. Adjust filters or split ratios.")
    else:
        counts = {"data": len(rows)}


    label_dist = compute_label_distribution(rows)
    support_analysis = compute_label_support_analysis(rows)
    overlap_info = check_cross_split_text_overlap(rows)
    if overlap_info["has_overlap"]:
        warnings.append(f"Detected {overlap_info['overlapping_texts_count']} identical text string(s) present across different splits.")

    return {
        "valid": True,
        "total_units": len(rows),
        "original_total": original_total,
        "capped_units_removed": removed_count,
        "counts": counts,
        "split_enabled": split,
        "max_doc_label_pct": max_doc_label_pct,
        "label_distribution": label_dist,
        "label_support_analysis": support_analysis,
        "cross_split_text_overlap": overlap_info,
        "warnings": warnings,
    }

