"""SQLite schema for the C3PA Explorer database.

Two layers, kept fully separable and auditable:

SOURCE (verbatim from the C3PA dataset repo)
  documents    - 400 policies (Htmls/ + Crawl/ metadata)
  annotations  - 45,121 annotator spans (Annotations/, verbatim Text/Label)

DERIVED (deterministic re-extraction + annotation alignment, layered on top)
  text_units   - every extracted text unit, typed:
                   unit_kind = 'sentence' | 'fragment'
                   NOTE: "sentence" means *a complete thought or idea*, NOT the
                   literal grammarian's sentence. Terminal punctuation is a
                   proxy, not a requirement: authors omit trailing periods
                   before URLs/emails and in contact paragraphs, and one
                   thought is often stretched across a bulleted <li> list
                   (which the extractor joins into the text flow). See the
                   comment block in backend/extract.py:classify_unit for the
                   full rationale.
                   fragment_type = phone | email | url | nav | copyright | heading
                                   | list_item | lead_in | short | other
                   label_category applies to SENTENCES ONLY. Values:
                     'single_label' | 'multi_label' | 'unlabeled'.
                   'unlabeled' is MEASUREMENT-RELATIVE: for this annotation
                   version (6 annotators x budget) the sentence produced no
                   annotation signal in the annotators' net. It is NOT evidence
                   that no C3PA label applies and must not be treated as a
                   verified negative (positive-unlabeled caution) -- the net is
                   a function of resolution, not of label applicability.
                   Fragments are NOT categorically un-labelable -- they carry a
                   NULL label-state. By design we scope labels to sentences for
                   the sentence/label-pairs goal (a label on a non-sentence is
                   noise for that purpose), so fragments carry the distinct
                   value 'not-eligible' with no unit_labels rows; the alignment
                   table still records every annotation that touched them, so
                   their labels could be surfaced under other conditions.
  unit_labels      - M2M unit <-> verbatim C3PA labels (sentence units only)
  alignment        - provenance: which annotation supports which unit & how
                     (annotation_in_sentence | sentence_in_annotation_paragraph | partial_overlap)
"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    doc_id      TEXT PRIMARY KEY,          -- e.g. 'DB_1'
    subset      TEXT NOT NULL,             -- 'DB' | 'WS'
    num         INTEGER NOT NULL,
    title       TEXT,                      -- <title> tag of the crawled page
    link        TEXT,
    is_homepage TEXT,
    textmatch_p TEXT,
    textmatch_s TEXT,
    textmatch_pp TEXT,
    link_match  TEXT,
    html_path   TEXT NOT NULL,             -- provenance: C3PA Htmls/{subset}/{num}.html
    crawl_path  TEXT,
    UNIQUE (subset, num)
);

CREATE TABLE IF NOT EXISTS annotations (
    annotation_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id           TEXT NOT NULL REFERENCES documents(doc_id),
    ranumb           TEXT NOT NULL,        -- annotator: ra1..ra6
    text             TEXT NOT NULL,        -- verbatim annotation span
    label            TEXT NOT NULL,        -- verbatim C3PA label
    status           TEXT NOT NULL,        -- 'aligned' | 'unmatched' | 'ambiguous'
    matched_units    TEXT,                 -- populated when status = 'ambiguous'
    src_row          INTEGER NOT NULL,     -- original row index inside the source CSV
    source_csv       TEXT NOT NULL,        -- provenance: C3PA Annotations/{subset}/{num}.csv
    UNIQUE (doc_id, src_row)
);
CREATE INDEX IF NOT EXISTS idx_annotations_doc   ON annotations(doc_id);
CREATE INDEX IF NOT EXISTS idx_annotations_label ON annotations(label);
CREATE INDEX IF NOT EXISTS idx_annotations_status ON annotations(status);

CREATE TABLE IF NOT EXISTS text_units (
    unit_id   TEXT PRIMARY KEY,            -- e.g. 'DB_1_U12'
    doc_id    TEXT NOT NULL REFERENCES documents(doc_id),
    position  INTEGER NOT NULL,            -- ordinal within the document
    block_seq INTEGER NOT NULL,            -- containing block index (for rendering)
    block_kind TEXT NOT NULL,              -- 'prose' | 'heading' | 'list'
    unit_text TEXT NOT NULL,
    unit_kind TEXT NOT NULL,               -- 'sentence' | 'fragment'
    fragment_type TEXT,                    -- for fragments
    label_category TEXT NOT NULL,          -- 'single_label' | 'multi_label' | 'unlabeled'
    annotator_count INTEGER NOT NULL DEFAULT 0,
    source_annotation_count INTEGER NOT NULL DEFAULT 0,
    alignment_types TEXT,                  -- ';'-joined alignment strategies
    UNIQUE (doc_id, position)
);
CREATE INDEX IF NOT EXISTS idx_units_doc   ON text_units(doc_id);
CREATE INDEX IF NOT EXISTS idx_units_kind  ON text_units(unit_kind);

CREATE TABLE IF NOT EXISTS unit_labels (
    unit_id TEXT NOT NULL REFERENCES text_units(unit_id),
    label   TEXT NOT NULL,
    PRIMARY KEY (unit_id, label)
);
CREATE INDEX IF NOT EXISTS idx_unit_labels_label ON unit_labels(label);

CREATE TABLE IF NOT EXISTS alignment (
    unit_id        TEXT NOT NULL REFERENCES text_units(unit_id),
    annotation_id  INTEGER NOT NULL REFERENCES annotations(annotation_id),
    alignment_type TEXT NOT NULL,
    PRIMARY KEY (unit_id, annotation_id)
);
CREATE INDEX IF NOT EXISTS idx_alignment_ann ON alignment(annotation_id);
"""

UNIT_FIELDS = [
    "id", "doc_id", "group", "text", "label", "label_name",
    "subset", "position", "unit_kind", "fragment_type", "label_category",
    "verbatim_labels", "annotator_count", "annotators",
    "source_annotation_count", "alignment_types",
]

# ---- connection helpers -------------------------------------------------------

DB_PATH = None


def connect():
    import sqlite3

    path = DB_PATH or "data/explorer.db"
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db(conn):
    conn.executescript(SCHEMA)
    conn.commit()


# ---- shared unit filter builder -----------------------------------------------

def support_tier_cond(mode: str, tier: int) -> str:
    """SQL predicate for a unit's support tier.

    mk = max distinct-annotator support across the unit's label pairs, n = the
    document's annotator pool. tiers: 3 unanimous (mk==n), 2 majority
    (mk>=ceil(n/2)), 1 minimal (mk>=1). mode 'at_least' matches 'this tier or
    greater'; 'exact' matches only units whose best support is exactly the tier.
    """
    ceil = "CAST((pl.n + 1) / 2 AS INTEGER)"
    if mode == "exact":
        return {
            3: "x.mk = pl.n",
            2: f"x.mk >= {ceil} AND x.mk < pl.n",
            1: f"x.mk >= 1 AND x.mk < {ceil}",
        }.get(tier, "x.mk >= 1")
    return {
        3: "x.mk = pl.n",
        2: f"x.mk >= {ceil}",
        1: "x.mk >= 1",
    }.get(tier, "x.mk >= 1")


def unit_support(conn, threshold: int = 1) -> dict:
    """Per-(unit,label) annotator support at an evidence threshold.

    k = distinct annotators with at least `threshold` aligned annotations for
    that (unit,label) pair; pool = the document's distinct annotator pool.
    stars: 3 unanimous (k == pool), 2 majority (k >= ceil(pool/2)), 1 minority
    (ceil = 50/50 rounds up; a single-annotator doc is always unanimous).
    Returns {unit_id: [{'label','k','pool','stars'}, ...]} for pairs with k >= 1.
    """
    import math

    pool = {r["doc_id"]: r["n"] for r in conn.execute(
        "SELECT doc_id, COUNT(DISTINCT ranumb) n FROM annotations GROUP BY doc_id")}
    votes = {}
    for r in conn.execute(
            """SELECT g.unit_id, u.doc_id, sl.label, a.ranumb, COUNT(*) c
               FROM unit_labels sl
               JOIN alignment g ON g.unit_id = sl.unit_id
               JOIN text_units u ON u.unit_id = g.unit_id
               JOIN annotations a ON a.annotation_id = g.annotation_id AND a.label = sl.label
               GROUP BY g.unit_id, u.doc_id, sl.label, a.ranumb"""):
        if r["c"] >= threshold:
            v = votes.setdefault((r["unit_id"], r["label"]), {"doc": r["doc_id"], "n": 0})
            v["n"] += 1
    out = {}
    for (unit_id, label), v in votes.items():
        p = pool.get(v["doc"], 0)
        k = v["n"]
        stars = 3 if k == p else 2 if k >= math.ceil(p / 2) else 1
        out.setdefault(unit_id, []).append({"label": label, "k": k, "pool": p, "stars": stars})
    return out


def build_unit_filter(params: dict) -> tuple[str, list]:
    """Builds a WHERE clause for unit queries from filter params.

    Supported keys:
      subset        - 'DB' | 'WS'
      doc_id        - exact document id
      category      - label category: 'single_label' | 'multi_label' | 'unlabeled'
                      (sentences only; fragments are 'not-eligible')
      unit_kind     - 'sentence' | 'fragment'
      fragment_type - fragment sub-type (when unit_kind == 'fragment')
      labels        - list of verbatim labels (matches units carrying ANY of them)
      exclude_labels- list of verbatim labels (EXCLUDES units carrying ANY of them)
      min_annotators- annotator_count >= N
      high_confidence - bool; single_label AND annotator_count >= 2
      q             - substring search over unit_text
      sample_view   - list of sample-family chips, OR'd together:
                      'single' | 'multi' | 'null' | 'fragments'
      evidence_threshold - int (default 1); for the 'single'/'multi' families a
                      label pair is supported only when some annotator produced
                      >= this many aligned annotations for it, so raising it
                      prunes underdefined sentences from the defined slice.
      min_support   - int 1..3 (default 1 = Minimal); only 'single'/'multi'
                      units with at least one label pair meeting the support
                      tier remain: 3 unanimous (all annotators), 2 majority
                      (>= ceil(pool/2) annotators), 1 minimal (>= 1).
      support_mode  - 'at_least' (default; this tier or greater) | 'exact'
                      (only records with exactly the tier).
    """
    where = []
    args = []

    if params.get("subset"):
        where.append("d.subset = ?")
        args.append(params["subset"])
    if params.get("doc_id"):
        where.append("u.doc_id = ?")
        args.append(params["doc_id"])
    if params.get("category"):
        where.append("u.label_category = ?")
        args.append(params["category"])
    if params.get("unit_kind"):
        where.append("u.unit_kind = ?")
        args.append(params["unit_kind"])
    if params.get("fragment_type"):
        where.append("u.fragment_type = ?")
        args.append(params["fragment_type"])
    if params.get("min_annotators"):
        where.append("u.annotator_count >= ?")
        args.append(int(params["min_annotators"]))
    if params.get("high_confidence"):
        where.append("u.label_category = 'single_label' AND u.annotator_count >= 2")
    if params.get("q"):
        where.append("u.unit_text LIKE ? ESCAPE '\\'")
        q = params["q"].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        args.append(f"%{q}%")
    if params.get("labels"):
        placeholders = ",".join("?" for _ in params["labels"])
        where.append(
            "u.unit_id IN (SELECT unit_id FROM unit_labels WHERE label IN (%s))"
            % placeholders
        )
        args.extend(params["labels"])
    if params.get("exclude_labels"):
        placeholders = ",".join("?" for _ in params["exclude_labels"])
        where.append(
            "u.unit_id NOT IN (SELECT unit_id FROM unit_labels WHERE label IN (%s))"
            % placeholders
        )
        args.extend(params["exclude_labels"])

    t = int(params.get("evidence_threshold") or 1)
    ms = int(params.get("min_support") or 1)
    if ms not in (1, 2, 3):
        ms = 1
    mode = params.get("support_mode") or "at_least"
    tier_cond = support_tier_cond(mode, ms)
    supported = (
        "u.unit_id IN (SELECT x.unit_id FROM ("
        "SELECT p.unit_id, p.doc_id, MAX(p.k) mk FROM ("
        "SELECT q.unit_id, q.doc_id, q.label, COUNT(*) k FROM ("
        "SELECT g.unit_id, u.doc_id, sl.label, a.ranumb FROM unit_labels sl "
        "JOIN alignment g ON g.unit_id = sl.unit_id "
        "JOIN text_units u ON u.unit_id = g.unit_id "
        "JOIN annotations a ON a.annotation_id = g.annotation_id AND a.label = sl.label "
        "GROUP BY g.unit_id, u.doc_id, sl.label, a.ranumb HAVING COUNT(*) >= ?) q "
        "GROUP BY q.unit_id, q.doc_id, q.label) p "
        "GROUP BY p.unit_id, p.doc_id) x "
        "JOIN (SELECT doc_id, COUNT(DISTINCT ranumb) n FROM annotations GROUP BY doc_id) pl "
        "ON pl.doc_id = x.doc_id "
        f"WHERE {tier_cond})"
    )
    if params.get("sample_view"):
        views = [v for v in params["sample_view"] if v in ("single", "multi", "null", "fragments")]
        if views:
            # A family that can never satisfy an active label/support filter
            # yields nothing: null/fragments carry no labels and no support.
            quality = bool(
                (ms > 1 or mode == "exact") or t > 1
                or params.get("labels") or params.get("exclude_labels")
            )
            conds = {
                "single": f"(u.unit_kind = 'sentence' AND u.label_category = 'single_label' AND {supported})",
                "multi": f"(u.unit_kind = 'sentence' AND u.label_category = 'multi_label' AND {supported})",
                "null": "(u.unit_kind = 'sentence' AND u.label_category = 'unlabeled')" if not quality else "(0)",
                "fragments": "(u.unit_kind = 'fragment')" if not quality else "(0)",
            }
            where.append("(" + " OR ".join(conds[v] for v in views) + ")")
            args.extend([t] * sum(1 for v in views if v in ("single", "multi")))
    elif ms > 1 or t > 1 or mode == "exact" or params.get("labels") or params.get("exclude_labels"):
        # "All" (no sample_view) with a label or support filter active: only
        # samples that can satisfy the requirement remain -- the defined
        # (single_label / multi_label) families passing the support gate.
        # Unlabeled sentences and fragments carry no labels/support, so they
        # can never meet the requirement and are excluded.
        where.append(
            f"(u.label_category IN ('single_label', 'multi_label') AND {supported})"
        )
        args.extend([t])

    if where:
        return " WHERE " + " AND ".join(where), args
    return "", args


UNIT_SELECT = """
    SELECT u.unit_id, u.doc_id, d.subset, u.position, u.block_kind, u.unit_text,
           u.unit_kind, u.fragment_type, u.label_category,
           u.annotator_count, u.source_annotation_count, u.alignment_types,
           (SELECT group_concat(sl.label, ';') FROM unit_labels sl
             WHERE sl.unit_id = u.unit_id ORDER BY sl.label) AS verbatim_labels,
           (SELECT group_concat(ranumb, ';') FROM
             (SELECT DISTINCT a.ranumb FROM alignment g
               JOIN annotations a ON a.annotation_id = g.annotation_id
               WHERE g.unit_id = u.unit_id ORDER BY a.ranumb)) AS annotators
    FROM text_units u
    JOIN documents d ON d.doc_id = u.doc_id
"""