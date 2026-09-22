"""Export helpers: deterministic train/eval/test partitioning for ML exports."""

import csv
import io
import json
import math
import random


def apply_max_doc_label_cap(rows: list[dict], max_pct: float) -> tuple[list[dict], int]:
    """Limits the number of unit rows per document for any given label.

    If max_pct > 0, no single label can occupy more than max_pct% of a document's
    total unit rows (with a minimum allowed floor of 1 unit).
    Returns (kept_rows, removed_count).
    """
    if max_pct <= 0 or not rows:
        return rows, 0

    doc_units: dict[str, list[dict]] = {}
    for r in rows:
        doc_id = r.get("doc_id", "unknown")
        doc_units.setdefault(doc_id, []).append(r)

    kept_rows = []
    removed_count = 0

    for doc_id, u_list in doc_units.items():
        doc_total = len(u_list)
        max_allowed = max(1, math.ceil(doc_total * max_pct / 100.0))

        label_counts: dict[str, int] = {}
        for r in u_list:
            labels = []
            if isinstance(r.get("label"), list):
                labels = r["label"]
            elif r.get("label"):
                labels = [l.strip() for l in str(r["label"]).split(";") if l.strip()]

            if not labels:
                labels = [r.get("verbatim_label") or "unlabeled"]

            exceeded = any(label_counts.get(l, 0) >= max_allowed for l in labels)
            if not exceeded:
                kept_rows.append(r)
                for l in labels:
                    label_counts[l] = label_counts.get(l, 0) + 1
            else:
                removed_count += 1

    return kept_rows, removed_count


def compute_label_distribution(rows: list[dict]) -> dict[str, int]:
    """Computes a histogram of label frequencies across rows."""
    dist: dict[str, int] = {}
    for r in rows:
        lbl = r.get("label")
        if isinstance(lbl, list):
            labels = lbl
        elif isinstance(lbl, str) and lbl:
            labels = [l.strip() for l in lbl.split(";") if l.strip()]
        else:
            labels = ["UNLABELED"]
        for l in labels:
            dist[l] = dist.get(l, 0) + 1
    return dict(sorted(dist.items(), key=lambda x: x[1], reverse=True))


def check_cross_split_text_overlap(rows: list[dict]) -> dict:
    """Checks if identical text strings appear across distinct partition splits."""
    text_splits: dict[str, set[str]] = {}
    for r in rows:
        txt = (r.get("text") or r.get("unit_text") or "").strip()
        if not txt:
            continue
        split = r.get("split", "train")
        text_splits.setdefault(txt, set()).add(split)

    overlapping = {txt: splits for txt, splits in text_splits.items() if len(splits) > 1}
    return {
        "overlapping_texts_count": len(overlapping),
        "has_overlap": len(overlapping) > 0,
    }



def partition(rows: list[dict], train: int, eval_: int, test: int,
              seed: int, stratify: bool) -> list[dict]:

    """Assigns each unit row a 'split' value using document-grouped seeded shuffle.

    Partitions are strictly grouped by document (doc_id) to prevent data leakage.
    With stratify=True, documents are grouped by primary label signature before
    partitioning so rare labels are represented across partitions without breaking
    document isolation.
    """
    total = train + eval_ + test
    if total != 100:
        raise ValueError("train/eval/test percentages must sum to 100")

    if not rows:
        return rows

    rng = random.Random(seed)

    # Group units by doc_id
    doc_units: dict[str, list[dict]] = {}
    for r in rows:
        doc_id = r.get("doc_id", "unknown")
        doc_units.setdefault(doc_id, []).append(r)

    doc_splits: dict[str, str] = {}

    if stratify:
        # Document-level stratification
        doc_label_map: dict[str, set[str]] = {}
        global_label_doc_counts: dict[str, int] = {}
        for doc_id, units in doc_units.items():
            labels = set()
            for u in units:
                v_labels = u.get("verbatim_labels")
                if v_labels:
                    for l in v_labels.split(";"):
                        if l:
                            labels.add(l)
                elif u.get("verbatim_label"):
                    labels.add(u["verbatim_label"])
            doc_label_map[doc_id] = labels
            for l in labels:
                global_label_doc_counts[l] = global_label_doc_counts.get(l, 0) + 1

        # Bin each document by its rarest label (or '__unlabeled__')
        label_bins: dict[str, dict[str, list[dict]]] = {}
        for doc_id, units in doc_units.items():
            labels = doc_label_map[doc_id]
            if labels:
                primary_label = min(labels, key=lambda l: (global_label_doc_counts[l], l))
            else:
                primary_label = "__unlabeled__"
            label_bins.setdefault(primary_label, {})[doc_id] = units

        for primary_label, bin_doc_units in label_bins.items():
            bin_splits = _assign_doc_splits(bin_doc_units, train, eval_, test, rng)
            doc_splits.update(bin_splits)
    else:
        doc_splits = _assign_doc_splits(doc_units, train, eval_, test, rng)

    # Assign split attribute to all rows
    for r in rows:
        doc_id = r.get("doc_id", "unknown")
        r["split"] = doc_splits.get(doc_id, "train")

    return rows


def _assign_doc_splits(doc_units: dict[str, list[dict]], train_pct: int, eval_pct: int, test_pct: int, rng: random.Random) -> dict[str, str]:
    """Assigns doc_ids to 'train', 'eval', or 'test' based on target unit percentages."""
    total_units = sum(len(units) for units in doc_units.values())
    if total_units == 0:
        return {}

    doc_ids = list(doc_units.keys())
    rng.shuffle(doc_ids)

    train_target = round(total_units * train_pct / 100)
    eval_target = round(total_units * eval_pct / 100)

    active_eval = eval_pct > 0
    active_test = test_pct > 0

    doc_splits: dict[str, str] = {}
    curr_train = 0
    curr_eval = 0

    for doc_id in doc_ids:
        u_len = len(doc_units[doc_id])
        if curr_train < train_target or (not active_eval and not active_test):
            doc_splits[doc_id] = "train"
            curr_train += u_len
        elif active_eval and curr_eval < eval_target:
            doc_splits[doc_id] = "eval"
            curr_eval += u_len
        else:
            doc_splits[doc_id] = "test" if active_test else "train"

    # Edge-case fallback for small document counts: ensure at least 1 doc per active split if enough docs
    active_splits = ["train"]
    if active_eval:
        active_splits.append("eval")
    if active_test:
        active_splits.append("test")

    assigned_splits = set(doc_splits.values())
    missing_splits = [s for s in active_splits if s not in assigned_splits]

    if missing_splits and len(doc_ids) >= len(active_splits):
        for missing in missing_splits:
            split_counts: dict[str, int] = {}
            for d, s in doc_splits.items():
                split_counts[s] = split_counts.get(s, 0) + 1
            donor_split = max(split_counts.items(), key=lambda x: x[1])[0]
            if split_counts[donor_split] > 1:
                for d, s in doc_splits.items():
                    if s == donor_split:
                        doc_splits[d] = missing
                        break

    return doc_splits


def _assign(rows: list[dict], train: int, eval_: int, test: int, rng: random.Random):
    n = len(rows)
    if n == 0:
        return
    rng.shuffle(rows)
    train_cut = round(n * train / 100)
    eval_cut = round(n * eval_ / 100)
    for i, r in enumerate(rows):
        if i < train_cut:
            r["split"] = "train"
        elif i < train_cut + eval_cut:
            r["split"] = "eval"
        else:
            r["split"] = "test"


def rows_to_csv(rows: list[dict], fieldnames: list[str]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    formatted_rows = []
    for r in rows:
        row_copy = {}
        for k in fieldnames:
            v = r.get(k, "")
            if isinstance(v, list):
                row_copy[k] = "; ".join(str(x) for x in v)
            else:
                row_copy[k] = v
        formatted_rows.append(row_copy)
    writer.writerows(formatted_rows)
    return buf.getvalue()


def rows_to_json(rows: list[dict], meta: dict) -> str:
    splits = {"train": [], "eval": [], "test": []}
    for r in rows:
        splits[r.get("split", "train")].append(r)
    return json.dumps(
        {
            "meta": meta,
            "counts": {k: len(v) for k, v in splits.items()},
            "splits": splits,
        },
        indent=2,
        ensure_ascii=False,
    )