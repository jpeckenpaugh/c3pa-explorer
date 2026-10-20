# Export API

`GET /api/export` packages a filtered slice of the C3PA Explorer corpus as a
timestamped ZIP. `GET /api/export/preview` validates the same query and returns
the counts, warnings, and label statistics the export would contain, without
building the ZIP.

This document is the reference for the FastAPI edition. The browser edition
exposes the same surface through the SPA; see [Browser edition](#browser-edition).

## Overview

The export is built from the **derived** `text_units` table: sentences and
fragments produced deterministically by `backend/extract.py`, with annotation
labels re-aligned onto those units. It is not a dump of raw annotator spans.

- Output: one ZIP per request, named `c3pa_export_YYYY-MM-DD-HH-MM.zip` in
  server local time.
- Contents: `meta.json` plus one CSV or JSON file per partition (`train_*`,
  `eval_*`, `test_*`) or a single `data_*` file when splitting is off.
- Audience: researchers who need a reproducible, document-grouped slice for
  training, evaluation, or manual review.
- Reproducibility: keep the snapshot identity (`builds.json` `db_sha256` and
  `db_short`), the full query string, and the emitted `meta.json`. The same
  snapshot plus the same filters, split ratios, seed, and `stratify` setting
  produce the same partition assignment within an edition.

### Source versus derived data

| Layer | What it is | Where to inspect it |
| :--- | :--- | :--- |
| Source | Verbatim C3PA HTML policies and 45,121 annotator spans (`ra1`-`ra6`) | `/api/documents/{doc_id}/annotations`, `/api/annotations` |
| Derived | `text_units` re-extracted from HTML, plus an `alignment` table mapping annotations to units | `/api/units`, `/api/alignment?unit_id=`, this export |

Caveats that affect downstream use:

- `label` is an uppercased token (for example
  `CATEGORIES_OF_PERSONAL_INFORMATION_COLLECTED`); `label_name` preserves the
  verbatim label. Multi-label rows carry multiple tokens.
- `UNLABELED` is measurement-relative. It means the annotation version produced
  no label signal for that unit; it is **not** a verified negative class. Treat
  it as positive-unlabeled data.
- Fragments are not label-eligible by design. Exporting fragments does not
  produce sentence/label pairs.
- The corpus contains repeated boilerplate across documents. Export does not
  deduplicate text. `cross_split_text_overlap` reports exact duplicate strings
  that appear in more than one partition.
- The ZIP is data only. It does not include the source HTML. Use the document
  endpoints if you need source spans or rendered policy text.

## Endpoint reference

### Routes

| Route | Response | Purpose |
| :--- | :--- | :--- |
| `GET /api/export` | `application/zip` attachment | Build and download the ZIP |
| `GET /api/export/preview` | `application/json` | Validate filters/splits and inspect counts before downloading |

Both routes accept the same query parameters. There is no request body and no
`POST` variant.

### Export and partition parameters

| Parameter | Type | Default | Applies to | Meaning |
| :--- | :--- | :--- | :--- | :--- |
| `format` | string | `csv` | both | Only the literal string `json` selects JSON. Any other value produces CSV files (with a `.csv` extension) and is echoed in `meta.format`; it is not rejected. |
| `split` | boolean | `true` | both | Enable `train`/`eval`/`test` partitioning. `false` writes one `data_*` file and assigns every row `split = "data"`. |
| `split_train` | integer | `80` | both | Train percentage. |
| `split_eval` | integer | `10` | both | Eval percentage. |
| `split_test` | integer | `10` | both | Test percentage. |
| `seed` | integer | `42` | both | Seed for the document shuffle. |
| `stratify` | boolean | `true` | both | Bin documents by rarest label before assigning partitions. |
| `exclude_other` | boolean | `false` | both | Append `Others` to `exclude_labels`. |
| `max_doc_label_pct` | number | `0` | both | `> 0` caps each label's rows within a document at `ceil(doc_rows * pct / 100)`, with a floor of 1. A row is dropped when any of its labels is already at the cap. `0` disables the cap. |
| `fields` | comma-separated string | see below | full export only | Columns to emit, in request order. Unknown names are silently dropped. Preview accepts the parameter but does not use it for its summary shape. |

Default `fields` when omitted:
`id,doc_id,text,label,label_name,split`.

Selectable fields (`backend/db.py:UNIT_FIELDS` plus export extras):

```
id, doc_id, group, text, label, label_name, subset, position,
unit_kind, fragment_type, label_category, verbatim_labels,
annotator_count, annotators, source_annotation_count, alignment_types,
support_stars, support_evidence, split
```

Notes:

- `id` is an alias of `unit_id`, `group` is an alias of `doc_id`, and `text` is
  an alias of `unit_text`.
- `support_stars` and `support_evidence` are the maximum support tier and
  maximum distinct-annotator count across the unit's label pairs. The raw
  `support` array is available from `/api/units` but is not exportable.
- The `split` column is emitted only if you include it in `fields`; partitioning still happens when `split=true`.
- If every requested field is unknown, `meta.selected_fields` is `[]`; CSV
  files then contain only blank lines and JSON files contain `{}` objects.

### Filter parameters (`UnitFilterParams`)

| Parameter | Type | Default | Meaning |
| :--- | :--- | :--- | :--- |
| `subset` | string | all | `DB` or `WS`. Exact match. |
| `doc_id` | string | all | Exact document id, for example `DB_1`. |
| `category` | string | all | `single_label`, `multi_label`, or `unlabeled`. Applies to sentences; fragments have their own `not-eligible` category. |
| `unit_kind` | string | all | `sentence` or `fragment`. |
| `fragment_type` | string | all | One of `heading`, `list_item`, `lead_in`, `short`, `nav`, `phone`, `email`, `url`, `copyright`, `other`. |
| `labels` | comma-separated string | none | Keep units carrying **any** listed verbatim label. A unit may also carry other labels. |
| `exclude_labels` | comma-separated string | none | Drop units carrying **any** listed verbatim label, even if they also match `labels`. |
| `min_annotators` | integer | none | Keep units with `annotator_count >= N`. This is the unit's annotator count, not the per-label support tier. |
| `high_confidence` | boolean | `false` | Equivalent to `category=single_label` plus `annotator_count >= 2`. |
| `q` | string | none | Substring match on `unit_text` (SQLite `LIKE`; `%` and `_` are escaped). |
| `sample_view` | comma-separated string | none | One or more of `single`, `multi`, `null`, `fragments`, OR'd together. Unknown chips are ignored; if none remain, no `sample_view` predicate is added. |
| `evidence_threshold` | integer | `1` | A label pair counts as support only when an annotator produced at least this many aligned annotations for it. Values above 1 also restrict an unfiltered query to defined (`single_label`/`multi_label`) families that pass the support gate. |
| `min_support` | integer | `1` | Required support tier for `single`/`multi` units: `3` unanimous, `2` majority (`>= ceil(pool/2)`), `1` minimal. Values outside 1-3 are coerced to `1`. |
| `support_mode` | string | `at_least` | `at_least` matches the requested tier or greater; `exact` matches only that tier. Any value other than `exact` behaves like `at_least`. |

Label names and `labels`/`exclude_labels` values are case-sensitive verbatim
labels. Use the spellings from `/api/labels` (for example
`Methods to exercise rights`). Commas separate values, so a label containing a
comma cannot be selected through this parameter.

Preview and full export accept the same query parameters. `fields` only changes
the full export's columns; preview accepts it but ignores it. `format` changes
the full export's file type and how multi-label `label`/`label_name` values are
represented, but preview reports the same counts either way. Every other
parameter listed above affects both endpoints.

`limit` and `offset` are not export parameters. They are ignored if supplied;
the SPA strips them before calling the export route.

### Validation rules

- With `split=true`, `split_train + split_eval + split_test` must equal exactly
  `100`. This is checked before partitioning, and applies even when one or two
  ratios are zero.
- `GET /api/export` returns HTTP `400` with
  `{"detail": "split_train + split_eval + split_test must equal 100"}` when the
  ratios are invalid.
- `GET /api/export/preview` returns HTTP `200` with
  `{"valid": false, "error": "split_train + split_eval + split_test must equal 100", ...}`
  for the same input.
- With `split=false`, ratios are ignored and not validated.
- Unknown `fields` are dropped. An empty selection is allowed and produces
  empty records.
- Malformed typed values (for example `split_train=abc` or `split=maybe`) are
  rejected by FastAPI with HTTP `422`, not `400`.
- An unrecognized `format` is not an error; it falls back to CSV as described
  above.
- A query matching zero units is valid at the HTTP level for the full export;
  see [Zero results](#zero-results-and-empty-splits).

## Copy-pasteable examples

Start the FastAPI edition first:

```bash
./install.sh    # once: creates .venv and data/explorer.db
./run.sh        # serves http://localhost:8765
```

All examples below were run against the v0.1 snapshot; observed results are in
[Verification](#verification).

### 1. CSV train/eval/test export

```bash
curl -sS -o c3pa_export.zip \
  'http://localhost:8765/api/export?format=csv&split=true&split_train=70&split_eval=15&split_test=15&seed=42&stratify=true'

python3 -m zipfile -l c3pa_export.zip
```

Observed layout on the full corpus:

```
meta.json
train_86729.csv
eval_18954.csv
test_15604.csv
```

The ratio targets are approximate because whole documents are assigned to a
partition. See [Partition semantics](#partition-semantics).

### 2. JSON export with selected fields

```bash
curl -sS -o c3pa_export_json.zip \
  'http://localhost:8765/api/export?format=json&fields=id,doc_id,text,label,label_name,split&split_train=70&split_eval=15&split_test=15&seed=42'
```

Each partition file is a top-level JSON array. With the fields above the layout
is:

```
meta.json
train_86729.json
eval_18954.json
test_15604.json
```

For multi-label rows in JSON, `label` and `label_name` are arrays. In CSV they
are `; `-joined strings. `annotators`, `verbatim_labels`, and
`alignment_types` remain semicolon-separated strings in both formats.

### 3. Preview before export

```bash
curl -sS 'http://localhost:8765/api/export/preview?format=csv&subset=DB&min_annotators=2&split_train=70&split_eval=15&split_test=15' \
  | python3 -m json.tool
```

Observed response (abridged):

```json
{
  "valid": true,
  "total_units": 15206,
  "original_total": 15206,
  "capped_units_removed": 0,
  "counts": { "train": 10969, "eval": 2491, "test": 1746 },
  "split_enabled": true,
  "max_doc_label_pct": 0,
  "warnings": [
    "Detected 522 identical text string(s) present across different splits."
  ],
  "cross_split_text_overlap": {
    "overlapping_texts_count": 522,
    "has_overlap": true
  }
}
```

The response also contains `label_distribution` and
`label_support_analysis`. Use the preview first: it is much cheaper than
building the ZIP and it reports zero-unit splits and cross-split text overlap.

### 4. Filtered export (label, subset, minimum annotators)

`labels` matches any unit carrying the label, so some returned units also carry
other labels. The URL-encode helper keeps the spaces in the label intact.

```bash
curl -sS -G -o filtered_export.zip 'http://localhost:8765/api/export' \
  --data-urlencode 'format=csv' \
  --data-urlencode 'subset=DB' \
  --data-urlencode 'labels=Methods to exercise rights' \
  --data-urlencode 'min_annotators=2' \
  --data-urlencode 'exclude_other=true' \
  --data-urlencode 'split_train=70' \
  --data-urlencode 'split_eval=15' \
  --data-urlencode 'split_test=15' \
  --data-urlencode 'seed=42' \
  --data-urlencode 'stratify=true'
```

Observed: 1,174 units across 205 documents, split `861 / 180 / 133`, with 21
exact-text overlaps reported across partitions. The emitted
`label_distribution` also lists other labels carried by those units.

To keep only units whose labels are exactly the requested set, add the other
labels to `exclude_labels`, or filter the emitted rows after export. There is no
"exclusive label set" parameter.

### 5. Split disabled (`split=false`)

```bash
curl -sS -o c3pa_export_all.zip \
  'http://localhost:8765/api/export?format=csv&split=false'

python3 -m zipfile -l c3pa_export_all.zip
```

Observed:

```
meta.json
data_121287.csv
```

Every row has `split = "data"`, and `meta.counts` is `{"total": ...}`. The same
rule applies to filtered exports and to `format=json` (`data_<count>.json`).

### 6. Python `requests` snippet

`requests` is not a project dependency; install it in your working environment
(`pip install requests`) if needed.

```python
import io
import json
import zipfile

import requests

BASE = "http://localhost:8765"
params = {
    "format": "csv",
    "split": "true",
    "split_train": 70,
    "split_eval": 15,
    "split_test": 15,
    "seed": 42,
    "stratify": "true",
}

preview = requests.get(f"{BASE}/api/export/preview", params=params, timeout=120)
preview.raise_for_status()
info = preview.json()
if not info.get("valid"):
    raise SystemExit(f"preview rejected the query: {info.get('error')}")

response = requests.get(f"{BASE}/api/export", params=params, timeout=300)
response.raise_for_status()

with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
    print(archive.namelist())
    meta = json.loads(archive.read("meta.json"))
    assert meta["total"] == info["total_units"]
    assert sum(meta["counts"].values()) == meta["total"]
    print(meta["counts"])
```

Use the same `params` dict for preview and export. If you change a filter
between the two calls, the counts can legitimately differ.

### Reproducible slice recipe

1. Record the snapshot identity from `builds.json` (`version`, `db_sha256`,
   `db_short`) or from the DB modal in the SPA.
2. Choose filters and run `/api/export/preview` until `valid` is true and the
   counts look right.
3. Save the preview JSON beside the ZIP.
4. Run `/api/export` with exactly the same parameters and keep the ZIP
   unmodified.
5. Keep `meta.json` with any derived dataset. It records the filters, split
   configuration, selected fields, counts, and `created_at`.

## ZIP layout and `meta.json`

`meta.json` is always the first entry. Data entries follow.

| Split mode | Data file names | Notes |
| :--- | :--- | :--- |
| `split=true` | `train_<count>.csv`, `eval_<count>.csv`, `test_<count>.json`, etc. | Only non-empty partitions get a file. `meta.counts` still lists all three keys in the full export, including zeros. |
| `split=false` | `data_<count>.csv` or `data_<count>.json` | One file containing every row, cap applied. |

`<count>` is the number of rows written to that file after
`max_doc_label_pct` is applied.

### `meta.json` fields

| Key | Present when | Meaning |
| :--- | :--- | :--- |
| `entity` | always | Always `"units"`. |
| `filters` | always | Filter values that were truthy, plus the support defaults. Lists for `labels`, `exclude_labels`, `sample_view`. `format` and split parameters are not repeated here. |
| `total` | always | Rows written after the document cap. |
| `original_total` | always | Rows matched before the document cap. |
| `format` | always | Echo of the requested `format` value. |
| `max_doc_label_pct` | always | Echo of the requested cap (`0` means off). |
| `capped_units_removed` | always | Rows removed by the document cap. |
| `unlabeled_count` | if > 0 | Rows with `label_category == "unlabeled"` (sentences only). |
| `unlabeled_note` | if `unlabeled_count` | Explains that unlabeled sentences are not verified negatives. |
| `fragments_note` | if any fragments | Explains that fragments are not label-eligible. |
| `evidence_threshold` | always | Support evidence threshold used for `support_stars`/`support_evidence`. |
| `min_support` | always | Echo of the support tier filter. |
| `support_mode` | always | Echo of the support mode. |
| `split` | `split=true` | `{train, eval, test, seed, stratify, grouped_by: "doc_id"}`. |
| `grouping_note` | `split=true` | States that partitions are grouped by `doc_id`. |
| `label_distribution` | always | Token counts over exported rows. |
| `label_support_analysis` | always | Per-token support/agreement statistics. |
| `cross_split_text_overlap` | always | Exact-text overlap report. |
| `selected_fields` | always | Fields emitted, in order, after unknown names were dropped. |
| `created_at` | always | ISO timestamp in server local time, without a timezone suffix. |
| `counts` | always | Partition counts. |

`counts` behavior has one asymmetry worth knowing:

- `split=true`: `counts` contains post-cap counts for `train`, `eval`, and
  `test`, including zero entries.
- `split=false`: `counts` is `{"total": <pre-cap matched count>}`, while the
  `data_<count>` filename and `meta.total` use the post-cap row count. Check
  `capped_units_removed` when the cap is active.

### `label_distribution`

A token-to-row-count map, sorted by descending count. A multi-label row counts
once for each token, so the values can sum to more than `meta.total`.
`UNLABELED` aggregates every exported row with no label, which includes both
unlabeled sentences and fragments. Use `unlabeled_count` and `unit_kind` when
you need to separate those cases.

### `label_support_analysis`

One object per token that appears in the exported rows:

| Field | Meaning |
| :--- | :--- |
| `raw_count` | Rows carrying the token. |
| `percentage_of_corpus` | `raw_count / meta.total * 100`, rounded to two decimals. Because rows can be multi-label, these percentages can sum past 100. |
| `distinct_documents` | Number of distinct `doc_id` values carrying the token. |
| `avg_supporting_annotators` | Mean `k` (distinct supporting annotators) over rows that have support info for the token. `0.0` when none do. |
| `mean_agreement_rate` | Mean `k / pool` over rows with support info, rounded to four decimals. |
| `unanimous_count` | Rows where the token's support tier was 3 (`k == pool`). |
| `disputed_count` | Rows where the token's support tier was 1 (minority support). |

Support is computed at `evidence_threshold` and capped to the exported rows.
`UNLABELED` normally has zeroes because it has no label pairs.

### `cross_split_text_overlap`

```json
{
  "overlapping_texts_count": 21,
  "has_overlap": true
}
```

The check compares exact, stripped `text` values and records how many appear in
more than one split. Empty text is ignored. With `split=false` every row is in
`data`, so the report is not meaningful and reports no overlap. Overlap here
usually means shared boilerplate across documents, not document leakage; the
grouping guarantee is enforced by `doc_id`, not by text uniqueness.

### Warnings

`preview` returns human-readable warnings in its `warnings` array:

- `Partition ratios must sum to 100%.` when the ratio check fails.
- `Current filter settings returned 0 units.` for an empty slice.
- `Split 'eval' yielded 0 units. Adjust filters or split ratios.` (and the same
  for `train`/`test`) when a requested split received no units.
- `Detected N identical text string(s) present across different splits.`

The full export does not include a warnings array; the same facts appear in
`meta.json` (`counts`, `cross_split_text_overlap`, notes) and in the HTTP
`400` for invalid ratios.

## Partition semantics

### Document grouping

Rows are grouped by `doc_id`; all units from one document land in the same
partition. This is the primary leakage guard: a sentence and its surrounding
context never straddle train/eval/test. Rows with no `doc_id` are grouped under
`"unknown"`.

### Seeded determinism

The export shuffles document ids with `random.Random(seed)` in the Python
edition, then assigns whole documents to partitions. With the same snapshot,
filters, ratios, `seed`, and `stratify`, the assignment is reproducible within
the Python edition. Re-running the same request does not re-randomize.

The browser edition uses its own seeded PRNG. It is deterministic within that
edition but is **not** byte-identical to CPython's Mersenne Twister. Do not
assume that `seed=42` produces the same document assignment in both editions.

### Ratio targeting

`split_train`, `split_eval`, and `split_test` are unit-percentage targets, but
assignment happens at document granularity. After the seeded shuffle, documents
are added to `train` until the train unit target is reached, then to `eval`
until the eval target is reached, then the remainder goes to `test`. A single
large document can overshoot a target, so observed percentages can differ from
the requested ones. On the full corpus, `70/15/15` produced
`86729 / 18954 / 15604` units (about `71.5% / 15.6% / 12.9%`).

### Stratification

With `stratify=true` (default), each document is assigned a primary label: its
rarest label by global document frequency, with label name as a tie-breaker.
Documents with no labels go into an `__unlabeled__` bin. The seeded
document-shuffle/assignment runs independently inside each bin. This spreads
rare labels across partitions more reliably than a global shuffle, but it is not
a guarantee: a label that occurs in only one document still lives in only one
partition.

With `stratify=false`, one global document shuffle assigns the whole slice.

### Small-corpus fallback

After assignment, if an active split is empty and there are at least as many
documents as active splits, the code moves one document from the largest donor
split into the empty split. This guarantees at least one document per active
split when that is possible, at the cost of exact ratios.

If there are fewer documents than active splits, the fallback cannot fill every
split. For example, exporting a single document with `70/15/15` sends all units
to `train`; preview warns that `eval` and `test` yielded 0 units, and the ZIP
contains only `train_<count>.*`.

### Split disabled

With `split=false`, no partitioning or ratio validation occurs. Every row gets
`split = "data"`, `meta.counts` is `{"total": ...}`, and the ZIP contains one
`data_<count>` file. This is the right mode for a single-document review or for
a corpus snapshot you intend to split yourself.

## Browser edition

The SPA exposes an equivalent export surface. It is not a separate API; the
same query parameters are sent through the in-page bridge when the sql.js engine
is active.

| Piece | Location | Role |
| :--- | :--- | :--- |
| Export modal | [`frontend/js/components/exportModal.js`](../frontend/js/components/exportModal.js) | Format, split mode (2-way, 3-way, off), ratios, seed, stratification, `exclude_other`, document cap, field selection, and preview-before-download. |
| Export service | [`frontend/sqljs/js/query/export-service.js`](../frontend/sqljs/js/query/export-service.js) | Port of `export_units` and `preview_export`: decorates rows, applies support, cap, and partition, then builds the ZIP in memory. |
| Pure helpers | [`frontend/sqljs/js/query/export.js`](../frontend/sqljs/js/query/export.js) | Tokenization, cap, label distribution, overlap check, partitioning, CSV/JSON serialization. |
| Export tests | [`tests/jbrowser_export.test.js`](../tests/jbrowser_export.test.js) | Drives the real snapshot: preview counts, ZIP central directory, `meta.json`, split files, CSV header, CRC-32, and document cap. |
| Modal unit tests | [`tests/frontend/export.test.js`](../tests/frontend/export.test.js) | Partition validation and field move/include behavior. |

The modal validates with `/api/export/preview` and only enables the download
after a valid preview. In browser mode the bridge serves `/api/export` from the
worker and returns the ZIP as a Blob. Field names, default fields, file naming,
and `meta.json` keys match the FastAPI edition.

Known cross-edition differences:

- Browser ZIP filenames and `created_at` use UTC; the FastAPI edition uses
  server local time.
- The seeded PRNG differs, as described in
  [Seeded determinism](#seeded-determinism).

## Troubleshooting

### HTTP 400: split ratios

```
{"detail":"split_train + split_eval + split_test must equal 100"}
```

Only the full export returns `400`. Preview returns `200` with `valid: false`
and the same message in `error`. Make the three values sum to exactly 100, even
if one of them is `0` (for example `80/0/20`). With `split=false` the check is
skipped.

### HTTP 422: malformed typed parameters

FastAPI rejects non-integer ratios/seed and non-boolean flags with `422`.
Send booleans as `true`/`false` and integers as plain digits.

### "Bad format" is silent

There is no format validation. `format=parquet`, `format=JSON`, or any other
value produces CSV output with a `.csv` extension; only lowercase `json`
produces JSON. `meta.format` echoes what you sent. Check the entry names and
`meta.selected_fields` if a request looks wrong.

### Zero results and empty splits

| Situation | Preview | Full export |
| :--- | :--- | :--- |
| No units match filters | `200`, `valid: false`, `error: "No units match the selected filter criteria."`, `total_units: 0` | `200` ZIP. With `split=true` it contains only `meta.json`; with `split=false` it contains `meta.json` and `data_0.csv` (header only). |
| One document, three active splits | `200`, `valid: true`, warning that `eval`/`test` yielded 0 units | `200` ZIP containing only `train_<count>.*`; `meta.counts` shows the zeros. |
| A requested split is empty | Warning naming the split | Same as above; empty partitions are omitted from the ZIP. |

Preview is the fastest diagnosis. If a split is empty, add documents (widen
`subset`/`doc_id`), lower the split ratios for the empty partition, switch to
two-way or `split=false`, or reduce restrictive filters.

### Empty or unexpected slice

- `labels`/`exclude_labels` use exact, case-sensitive verbatim labels. A typo
  yields zero matches.
- `labels` matches units carrying **any** requested label; `exclude_labels`
  removes units carrying any excluded label. Combining both can shrink a slice
  quickly.
- `min_annotators` filters the unit's annotator count. `min_support` and
  `evidence_threshold` are different: they gate per-label aligned support. A
  high `min_support`, `evidence_threshold > 1`, `support_mode=exact`, or any
  label filter restricts the slice to defined sentence families, excluding
  unlabeled sentences and fragments. Drop those filters if you want the
  unlabeled/fragment slice.
- `sample_view=null` or `sample_view=fragments` combined with a label or
  support filter intentionally yields nothing; those families cannot satisfy
  the label/support gate.
- `category` and `fragment_type` are exact enums; an unrecognized value returns
  zero rows rather than an error.

### Unexpectedly empty `fields`

Unknown names in `fields` are dropped silently. If all names are unknown,
`meta.selected_fields` is `[]`, CSV files contain blank lines, and JSON files
contain empty objects. Use the field list in
[Export and partition parameters](#export-and-partition-parameters).

### Overlap warning

`Detected N identical text string(s) present across different splits.` does not
mean the document grouping failed. The grouping guard is `doc_id`; the check is
an exact text comparison and commonly fires on repeated policy boilerplate or
duplicated documents. If duplicate text is a problem for your experiment,
deduplicate by `text` or group by document in your analysis.

## Verification

Executed on 2026-10-20 against `c3pa-db_v0.1_663586da.tar.gz`
(`db_sha256` starts with `663586da...`, 121,287 units, 400 documents).

The verification container did not have `python3-venv`, so the app was served
with the same Uvicorn module the `run.sh` script invokes, using an isolated
dependency install:

```bash
C3PA_DB_PATH=/tmp/c3pa-verify/db/explorer.db \
PYTHONPATH=/tmp/c3pa-deps:. python3 -m uvicorn backend.main:app \
  --host 127.0.0.1 --port 8765
```

The DB path pointed at a pristine copy of the v0.1 snapshot. The endpoints,
query parameters, and responses are identical to `./run.sh` on
`http://localhost:8765`.

| Example | Result |
| :--- | :--- |
| CSV, `70/15/15`, full corpus | `200`, one `c3pa_export_<timestamp>.zip`, entries `meta.json`, `train_86729.csv`, `eval_18954.csv`, `test_15604.csv`; `meta.total = 121287`. |
| JSON, six selected fields, `70/15/15` | `200`, entries `train_86729.json`, `eval_18954.json`, `test_15604.json`; `meta.selected_fields` is exactly the six requested fields. |
| Preview, `subset=DB&min_annotators=2`, `70/15/15` | `200`, `valid: true`, `total_units: 15206`, counts `10969 / 2491 / 1746`, one warning for 522 cross-split exact-text overlaps. |
| Filtered export, `subset=DB`, `labels=Methods to exercise rights`, `min_annotators=2`, `exclude_other=true`, `70/15/15` | `200`, counts `861 / 180 / 133`, `meta.total = 1174`, 21 cross-split exact-text overlaps. |
| `split=false`, full corpus CSV | `200`, entries `meta.json`, `data_121287.csv`; every row has `split = data`. |
| `split=false`, `format=json`, `doc_id=DB_1`, all selectable fields | `200`, `data_305.json`; list-valued fields serialize as JSON arrays/strings as described. |
| Invalid ratios on full export (`80/15/15`) | `400`, `{"detail":"split_train + split_eval + split_test must equal 100"}`. |
| Invalid ratios on preview | `200`, `valid: false`, same error, warning `Partition ratios must sum to 100%`. |
| `format=parquet`, `split=false` | `200`, CSV entry `data_121287.csv`; `meta.format = "parquet"`. |
| Empty filter (`doc_id=NO_SUCH_DOC`) | Preview `200 valid:false`; full export `200` with only `meta.json`; `split=false` export with `meta.json` and header-only `data_0.csv`. |
| Single document (`doc_id=DB_1`) with `70/15/15` | Preview warns that `eval` and `test` yielded 0 units; export contains only `train_305.csv`; `meta.counts` is `{"train": 305, "eval": 0, "test": 0}`. |
| Document cap, `doc_id=DB_1&max_doc_label_pct=5&split=false` | Preview: `total_units: 102`, `original_total: 305`, `capped_units_removed: 203`; export: `data_102.csv`, `meta.total: 102`, `meta.counts.total: 305`. |
| Python `requests` preview + export round trip | `200` for both; preview counts matched the ZIP's `meta` counts. |

Not executed:

- The browser edition's in-page export (requires a browser/WASM runtime). Its
  behavior is covered by `tests/jbrowser_export.test.js`; the cross-edition
  timestamp and PRNG differences noted above were read from the source.

## Related code

- [`backend/api/export.py`](../backend/api/export.py) - routes and query
  parameters
- [`backend/services/export_service.py`](../backend/services/export_service.py)
  - row decoration, ZIP assembly, preview response
- [`backend/export.py`](../backend/export.py) - cap, distribution, overlap,
  partitioning, CSV serialization
- [`backend/schemas/units.py`](../backend/schemas/units.py) -
  `UnitFilterParams`
- [`backend/db.py`](../backend/db.py) - `UNIT_FIELDS`, `build_unit_filter`,
  `unit_support`
