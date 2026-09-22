"""Deterministic HTML -> text-unit extraction for the C3PA Explorer.

Replaces the parser's line-based spaCy sentencizer with a fully rule-based,
auditable pipeline:

    HTML
      -> structural pass  (drop chrome containers: nav/header/footer/menu/...)
      -> leaf text blocks (paragraphs, headings, list items)
      -> rule-based sentence splitter (abbreviation/initial/decimal/URL guards)
      -> unit classifier  (sentence | fragment + typed fragment sub-class)

No trained models anywhere - every decision is a deterministic rule.
"""

import csv
import os
import re
import unicodedata
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# 1. Structural chrome classification
# ---------------------------------------------------------------------------

CHROME_TAGS = {
    "nav", "header", "footer", "aside", "button", "select", "input",
    "textarea", "script", "style", "noscript", "svg", "canvas", "iframe",
    "template", "dialog", "audio", "video",
}

# class/id tokens (compared against normalized "foo bar" form, so hyphens
# and underscores collapse to spaces). Word-sequence match with a guard so a
# token preceded by "no"/"non"/"article" is NOT treated as chrome (e.g. Best
# Buy's "no-header-paragraph" and "article header__small" content classes).
CHROME_TOKENS = [
    "navbar", "topbar", "top bar", "breadcrumb", "cookie", "consent", "modal",
    "popup", "drawer", "subscribe", "newsletter", "signup", "sign in", "signin",
    "login", "logout", "sidebar", "pagination", "advertisement", "ad banner",
    "announcement", "promo", "toast", "toolbar", "chat", "drift", "messenger",
    "back to top", "secondary menu", "top navigation", "mobile nav",
    "site header", "site footer", "main header", "main footer", "page header",
    "page footer", "top header", "top footer", "footer", "header", "menu",
    "nav", "main menu", "primary menu", "menu container", "et info",
    "tb footer", "tb header", "acsb", "masthead",
]
_CHROME_GUARD = {"no", "non", "article"}

# Bare generic words that are only treated as chrome when the class/id is
# SHORT. Long compound classes like "closed-mobile-header" or
# "no-header-paragraph" are often page wrappers or content, not chrome --
# matching the bare word there would drop the whole document (e.g. DB_8).
# "topbar" joins the list because full-page wrappers like
# "body_wrapper header_topbar" (DB_21) contain the ENTIRE document; a real top
# bar is a standalone "topbar"/"site topbar" (<= 2 words), which still matches.
_SHORT_ONLY = {"header", "footer", "nav", "menu", "sidebar", "promo", "topbar"}
# a matched generic word followed by a layout negation ("sidebar-none",
# "no-sidebar") describes the page layout, not a chrome region
_NEGATION = {"none", "no", "without", "absent", "closed", "hidden", "off"}
# a short-only chrome token followed by one of these is a page wrapper /
# content region, NOT chrome: "nav-content", "header-wrapper",
# "footer-container" hold the actual policy text (WS_38, WS_94). The explicit
# multiword chrome tokens ("menu container", "site header", ...) are still
# checked separately and catch genuine chrome containers.
_CONTENT_WRAP = {"content", "wrapper", "wrap", "container", "holder", "main",
                 "body", "area", "section", "region"}

BLOCK_CONTENT_TAGS = {
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "dt", "dd",
    "blockquote", "figcaption", "pre", "caption",
}

# tags that make a generic container a "container" (recurse) rather than a leaf
BLOCK_STRUCT_TAGS = {
    "p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
    "blockquote", "pre", "figure", "figcaption", "header", "footer", "nav",
    "aside", "main", "form", "fieldset", "address", "hr", "dl", "dt", "dd",
}

# inline chrome to strip from inside content blocks
INLINE_STRIP_TAGS = {"button", "input", "select", "textarea", "img", "svg",
                     "iframe", "canvas", "video", "audio", "script", "style"}

# inline text elements whose content is captured by their parent block
INLINE_SKIP_TAGS = {"a", "span", "strong", "em", "i", "b", "u", "font", "small",
                    "sub", "sup", "label", "abbr", "code", "time", "mark", "ins",
                    "del", "cite", "q", "br", "wbr", "bdo", "big"}

_WS = re.compile(r"\s+")


def _normalize_attrs(node) -> str:
    classes = " ".join(node.get("class") or [])
    node_id = node.get("id") or ""
    return _WS.sub(" ", f"{classes} {node_id}".replace("-", " ").replace("_", " ")).lower()


def is_chrome_node(node) -> bool:
    if not getattr(node, "name", None):
        return False
    if node.name in CHROME_TAGS:
        return True
    hay = _WS.sub(" ", _normalize_attrs(node)).split()
    for tok in CHROME_TOKENS:
        words = tok.split()
        for i in range(len(hay) - len(words) + 1):
            if hay[i:i + len(words)] == words:
                if i == 0 or hay[i - 1] not in _CHROME_GUARD:
                    if tok in _SHORT_ONLY:
                        if len(hay) > 2:
                            continue
                        if i + len(words) < len(hay):
                            nxt = hay[i + len(words)]
                            if nxt in _NEGATION or nxt in _CONTENT_WRAP:
                                continue
                    return True
    return False


def extract_title(html: str) -> str:
    """The document's <title> tag (the browser-tab title of the crawled page)."""
    soup = BeautifulSoup(html, "html.parser")
    t = soup.find("title")
    if t is None:
        return ""
    return _WS.sub(" ", t.get_text(" ", strip=True)).strip()


def extract_blocks(html: str) -> list[dict]:
    """Walks the DOM and emits leaf text blocks in document order.

    Each block is {kind: 'prose'|'heading'|'list', text: <collapsed text>}.
    """
    soup = BeautifulSoup(html, "html.parser")
    for tag in ("script", "style", "noscript", "head", "svg", "title"):
        for el in soup.find_all(tag):
            el.decompose()
    for el in soup.find_all(INLINE_STRIP_TAGS):
        el.decompose()

    blocks: list[dict] = []

    def emit(name, t):
        t = _WS.sub(" ", t).strip()
        if t and any(c.isalnum() for c in t):
            kind = ("heading" if name in ("h1", "h2", "h3", "h4", "h5", "h6")
                    else "list" if name == "li" else "prose")
            blocks.append({"kind": kind, "text": t})

    def process(node, depth=0):
        if depth > 60:
            return
        if getattr(node, "name", None) is None:
            return
        if is_chrome_node(node):
            return
        name = node.name
        if name in INLINE_SKIP_TAGS:
            if not node.find(list(BLOCK_STRUCT_TAGS)):
                return
        if name in BLOCK_CONTENT_TAGS:
            emit(name, node.get_text(" ", strip=True))
            return
        if name in ("ul", "ol"):
            # Lists join the text flow: <li> is presentation, exactly like
            # <p>/<div>/<a>/<br>. The item text already carries the ";" and
            # "and" separators, so joining the items yields the sentence a
            # reader actually sees. (Design note: "sentence" here means a
            # *complete thought or idea*; a policy author frequently stretches
            # one thought across a bulleted list, e.g. "you may have the
            # following additional rights: the right to access; the right to
            # rectification; ...". We do not hoard the literal <li> boundary.)
            items = []
            for li in node.find_all("li", recursive=True):
                t = _WS.sub(" ", li.get_text(" ", strip=True)).strip()
                if t:
                    items.append(t)
            if items:
                blocks.append({"kind": "list", "text": " ".join(items)})
            return
        if name in ("table", "tbody", "thead", "tfoot", "tr"):
            cells = node.find_all(["td", "th"], recursive=False)
            if cells:
                for cell in cells:
                    process(cell, depth + 1)
                return
            # no direct cell children (e.g. table > tbody > tr > td): fall
            # through to generic container recursion instead of dropping the
            # whole table (DB_21 stores all its policy text in such tables)
        # generic container: recurse only if it has block-structure children;
        # otherwise it is a leaf text container (e.g. div > "direct text")
        block_children = [c for c in node.children
                          if getattr(c, "name", None) and c.name in BLOCK_STRUCT_TAGS]
        if not block_children:
            emit(name, node.get_text(" ", strip=True))
            return
        # mixed content: leading/inline text before block children (e.g.
        # "<div>intro sentence...<p>rest</p></div>")
        inline_copy = BeautifulSoup(str(node), "html.parser")
        root = inline_copy.find()
        if root is not None:
            for b in root.find_all(BLOCK_STRUCT_TAGS):
                b.decompose()
            lead = _WS.sub(" ", root.get_text(" ", strip=True)).strip()
            if lead:
                emit(name, lead)
        for child in node.children:
            process(child, depth + 1)

    for child in soup.body.children if soup.body else []:
        process(child)

    return _merge_leadin_lists(blocks)


def _merge_leadin_lists(blocks: list[dict]) -> list[dict]:
    """A prose block ending in ':' introduces whatever follows, so a lead-in
    immediately followed by a list is really ONE complete thought:

        "...you may have the following additional rights:"  +  <ul>items</ul>
            -> "...you may have the following additional rights: the right to
                access; ... and the right to complain to a supervisory authority"

    This mirrors how the pipeline already treats other tag boundaries as
    presentation; the lead-in's colon is the grammatical join, not the <ul> tag.
    """
    merged: list[dict] = []
    i = 0
    while i < len(blocks):
        b = blocks[i]
        nxt = blocks[i + 1] if i + 1 < len(blocks) else None
        if (nxt and nxt["kind"] == "list" and b["kind"] == "prose"
                and b["text"].rstrip().endswith(":")):
            merged.append({"kind": "prose",
                           "text": b["text"].rstrip() + " " + nxt["text"]})
            i += 2
        else:
            merged.append(b)
            i += 1
    return merged


# ---------------------------------------------------------------------------
# 2. Deterministic sentence splitter
# ---------------------------------------------------------------------------

_ABBREVIATIONS = {
    "mr", "mrs", "ms", "miss", "dr", "prof", "rev", "capt", "col", "gen", "lt",
    "sgt", "gov", "sen", "rep", "dept", "est", "inc", "ltd", "corp", "co",
    "jr", "sr", "i.e", "e.g", "etc", "vs", "ph.d", "u.s", "u.k", "u.s.a",
    "no", "nos", "fig", "vol", "st", "mt", "ft", "sec", "min", "hrs", "approx",
    "esq", "univ", "calif", "ave", "blvd", "ct", "rd",
    "a.m", "p.m", "am", "pm", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
    "sep", "sept", "oct", "nov", "dec", "mon", "tue", "wed", "thu", "fri", "sat", "sun",
}

# note: the value is only used as a set lookup on the lowercased token before '.'
_ABBREV_SET = _ABBREVIATIONS

_CLOSING = "”\"'）)]»"


_URL_EMAIL = re.compile(
    r"https?://[^\s,;()]+|www\.[^\s,;()]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}", re.I)


def _mask(text: str):
    """Replaces URL/email substrings with inert placeholders so their internal
    periods never trigger sentence boundaries. Returns (masked, originals).

    A trailing sentence-final period after a URL is *not* part of the URL: it
    is re-emitted after the placeholder so it stays a sentence boundary.
    """
    parts = []

    def repl(m):
        raw = m.group(0)
        tail = ""
        if raw.endswith((".", "!", "?")):
            tail = raw[-1]
            raw = raw[:-1]
        parts.append(raw)
        return f" \u0001{len(parts) - 1}\u0001 {tail}"

    masked = _URL_EMAIL.sub(repl, text)
    return masked, parts


def split_sentences(text: str) -> list[str]:
    """Splits paragraph text into sentence candidates using explicit rules."""
    masked, parts = _mask(text)
    units: list[str] = []
    start = 0
    n = len(masked)
    i = 0
    while i < n:
        ch = masked[i]
        if ch in ".!?" and _is_boundary(masked, i):
            j = i + 1
            while j < n and masked[j] in _CLOSING:
                j += 1
            units.append(masked[start:j].strip())
            start = j
            i = j
        else:
            i += 1
    tail = masked[start:].strip()
    if tail:
        units.append(tail)
    units = [u for u in units if u]
    # restore protected substrings
    for k, u in enumerate(units):
        units[k] = re.sub(r"\u0001(\d+)\u0001",
                          lambda m: parts[int(m.group(1))], u)
    return units


def _next_nonspace(text: str, i: int):
    j = i + 1
    while j < len(text) and text[j] in (" ", _CLOSING):
        j += 1
    return j


def _is_boundary(text: str, i: int) -> bool:
    ch = text[i]

    # '!' and '?' are always sentence-final (guard against !?/?! sequences)
    if ch in "!?":
        if i + 1 < len(text) and text[i + 1] in "!?":
            return False
        return True

    # ellipsis / repeated periods
    if (i + 1 < len(text) and text[i + 1] == ".") or (i > 0 and text[i - 1] == "."):
        return False

    # scan backwards over closing quotes/parens, whitespace and masked
    # placeholders to find the "real" token before the period
    j = i - 1
    while j >= 0:
        c = text[j]
        if c in " \t\n" or c in _CLOSING:
            j -= 1
        elif c == "\u0001":          # end of a masked URL/email placeholder
            k = j
            while k >= 0 and text[k] != "\u0001":
                k -= 1
            j = k - 1
        else:
            break
    if j < 0 or not text[j].isalnum():
        return False

    # abbreviation / initial / URL checks on the token ending at j
    prev_start = j
    while prev_start > 0 and text[prev_start - 1].isalnum():
        prev_start -= 1
    prev_token = text[prev_start:j + 1].lower()
    if prev_token in _ABBREV_SET:
        return False
    if len(prev_token) == 1 and prev_token.isalpha():
        return False
    if "/" in text[prev_start:j + 1]:
        return False

    # next character after optional closing quotes
    nxt = _next_nonspace(text, i)
    if nxt >= len(text):
        return True
    nxt_ch = text[nxt]

    if nxt_ch.isdigit():
        return False
    if nxt_ch.islower():
        return False
    # next is uppercase -> sentence boundary
    return True


# ---------------------------------------------------------------------------
# 3. Unit classifier (sentence vs fragment + sub-types)
# ---------------------------------------------------------------------------

# deterministic verb probe: privacy-policy vocabulary + auxiliaries/modals
VERB_PROBE = {
    # auxiliaries / modals
    "is", "are", "was", "were", "be", "been", "being", "am", "have", "has",
    "had", "do", "does", "did", "may", "might", "can", "could", "will", "would",
    "shall", "should", "must", "need", "ought",
    # lexical verbs common in privacy policies
    "use", "uses", "used", "using", "collect", "collects", "collected", "collecting",
    "share", "shares", "shared", "sharing", "disclose", "discloses", "disclosed",
    "disclosing", "sell", "sells", "sold", "selling", "delete", "deletes",
    "deleted", "deleting", "store", "stores", "stored", "storing", "retain",
    "retains", "retained", "retaining", "process", "processes", "processed",
    "processing", "provide", "provides", "provided", "providing", "offer",
    "offers", "offered", "offering", "require", "requires", "required",
    "requiring", "allow", "allows", "allowed", "allowing", "permit", "permits",
    "permitted", "permit", "apply", "applies", "applied", "access", "accesses",
    "accessed", "transfer", "transfers", "transferred", "transferring",
    "receive", "receives", "received", "receiving", "obtain", "obtains",
    "obtained", "obtaining", "protect", "protects", "protected", "protecting",
    "safeguard", "safeguards", "safeguarded", "secure", "secures", "secured",
    "maintain", "maintains", "maintained", "maintaining", "update", "updates",
    "updated", "updating", "change", "changes", "changed", "changing", "inform",
    "informs", "informed", "informing", "notify", "notifies", "notified",
    "notifying", "contact", "contacts", "contacted", "contacting", "request",
    "requests", "requested", "requesting", "consent", "consents", "consented",
    "object", "objects", "objected", "restrict", "restricts", "restricted",
    "correct", "corrects", "corrected", "erase", "erases", "erased", "remove",
    "removes", "removed", "removing", "govern", "governs", "governed",
    "control", "controls", "controlled", "limit", "limits", "limited",
    "track", "tracks", "tracked", "log", "logs", "logged", "record", "records",
    "recorded", "publish", "publishes", "published", "post", "posts", "posted",
    "display", "displays", "displayed", "send", "sends", "sent", "sending",
    "deliver", "delivers", "delivered", "transmit", "transmits", "transmitted",
    "comply", "complies", "complied", "ensure", "ensures", "ensured",
    "describe", "describes", "described", "contain", "contains", "contained",
    "include", "includes", "included", "cover", "covers", "covered",
    "explain", "explains", "explained", "state", "states", "stated",
    "outline", "outlines", "outlined", "summarize", "summarizes", "summarized",
    "define", "defines", "defined", "means", "refers", "refer", "referred",
    "relate", "relates", "related", "belongs", "concern", "concerns",
    "concerned", "represent", "represents", "represented", "let", "lets",
    "make", "makes", "made", "take", "takes", "taken", "give", "gives", "given",
    "look", "looks", "follow", "follows", "followed", "continue", "continues",
    "continued", "reserve", "reserves", "reserved", "review", "reviews",
    "reviewed", "expect", "expects", "expected", "happen", "happens", "happened",
    "agree", "agrees", "agreed", "accept", "accepts", "accepted", "remain",
    "remains", "remained", "believe", "believes", "believed", "understand",
    "understands", "understood", "know", "knows", "known", "note", "notes",
    "noted", "assume", "assumes", "assumed", "assure", "assures", "assured",
}

# exact-match chrome labels (whole unit, lowercased)
CHROME_LABELS = {
    "login", "log in", "sign in", "sign up", "register", "contact us", "about us",
    "home", "menu", "search", "faq", "help", "get started", "free trial",
    "pricing", "privacy policy", "terms", "terms of use", "terms & conditions",
    "terms and conditions", "cookie policy", "sitemap", "language", "english",
    "español", "espanol", "more", "learn more", "read more", "accept", "agree",
    "decline", "ok", "okay", "close", "submit", "cancel", "back", "next",
    "continue", "shop", "cart", "account", "my account", "support", "download",
    "subscribe", "unsubscribe", "newsletter", "all rights reserved", "back to top",
}

_PHONE = re.compile(r"^\+?[\d][\d\s().\-]{5,}$")
_PHONE2 = re.compile(r"^\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}$")
_EMAIL = re.compile(r"^[\w.+-]+@[\w.-]+\.[a-z]{2,}$", re.I)
# scheme-less domains too ("VDX.tv", "example.com"), so a sentence-final bare
# domain is recognized as a URL-final complete thought ("Learn more at VDX.tv .")
_URL = re.compile(r"^(https?://|www\.|([a-z0-9-]+\.)+[a-z]{2,})(/\S*)?$", re.I)
_COPYRIGHT = re.compile(r"^(©|copyright\b).*(\d{4}|all rights reserved)", re.I)
_NUMBERED_HEADING = re.compile(r"^\d+(\.\d+)*[\.\:]?\s+\S")
_ROMAN_HEADING = re.compile(r"^[IVX]+\.?\s+\S")
_ALLCAPS_SHORT = re.compile(r"^[A-Z0-9\s\-/&.'’%]{2,}$")
_LIST_ITEM_END = re.compile(r";(\s+(and|or))?$")
# words that begin a *dependent* clause; without a following main clause the
# unit is NOT a complete thought (e.g. "When you use our Services" alone)
_SUBORDINATE_START = re.compile(
    r"^(when|if|although|because|unless|while|after|before|since|whereas|"
    r"whether|as|though|until|provided)\b", re.I)

# Structural finite-verb signals. VERB_PROBE is a curated wordlist with
# inherent gaps ("pledges", "conduct", "recommend", ...), and enumerating verbs
# forever is whack-a-mole. These two *structural* patterns catch the gap
# classes with high precision and no wordlist growth:
#   1) a modal/auxiliary (or its contraction): "we MAY need", "we CANNOT
#      guarantee", "you MUST opt out"
#   2) a subject pronoun directly before a verb: "WE recommend", "YOU waive",
#      "THEY collect"
_MODAL_AUX = re.compile(
    r"\b(am|is|are|was|were|have|has|had|do|does|did|may|might|must|can|could|"
    r"will|would|shall|should|need|ought|cannot|can't|won't|don't|doesn't|didn't|"
    r"isn't|aren't|wasn't|weren't|haven't|hasn't|hadn't|shouldn't|couldn't|"
    r"wouldn't|mustn't|needn't)\b", re.I)
_SUBJECT_VERB = re.compile(r"\b(we|you|they|i|it)\s+[a-z]+\b", re.I)
# 3) "please <verb>" -- a politeness-marker imperative ("Please read this
#    Policy carefully.", "please visit the site", "please contact us")
_PLEASE_IMPERATIVE = re.compile(r"\bplease\s+[a-z]+\b", re.I)
# 4) a word ending in -s/-ed directly before a determiner or adverb -- the
#    noun-subject finite-verb signature that the pronoun/aux rules cannot see:
#    "VDX.tv acts ethically", "The ad server checks the ...",
#    "Experian facilitated the ...", "Company has disclosed the ..."
_S_ED_DET_ADV = re.compile(
    r"\b(\w+(?:s|ed))\s+(the|this|these|those|our|your|their|its|his|her|a|an|\w+ly)\b",
    re.I)


def _has_finite_verb_signal(t: str) -> bool:
    """True when the text carries a structure-based sign of a finite verb.

    Known residual gap (accepted per design): bare present-tense verbs after a
    plural-noun subject ("Our Partners perform ...") and bare imperatives
    without "please" ("Click here to opt-out") are indistinguishable from
    nouns without a parser, so those remain fragments. This is the deliberate
    conservative direction -- see classify_unit.
    """
    return bool(_MODAL_AUX.search(t) or _SUBJECT_VERB.search(t)
                or _PLEASE_IMPERATIVE.search(t) or _S_ED_DET_ADV.search(t))


def _is_phone(t: str) -> bool:
    if sum(c.isdigit() for c in t) < 7:
        return False
    return bool(_PHONE.match(t) or _PHONE2.match(t))


# trailing whitespace + sentence punctuation + closing quotes/parens
_TRAILING_PUNCT = re.compile(r"[\s.!?;:\u201d\u201c\"'）)\]»]+$")


def _ends_in_url_email(t: str) -> bool:
    """True when the unit's final token is a URL or email.

    Policy editors terminate a URL-final sentence in (at least) two ways, and
    both must count as sentence-final:
        DB_1 convention: "...policy at https://example.com/terms"      (no period)
        DB_2 convention: "...policy at https://example.com/terms ."    (space, period)
    A trailing period would alter the resource locator, so both conventions
    omit the period *glued to the URL*; we strip trailing punctuation/space
    and test the last real token.
    """
    stripped = _TRAILING_PUNCT.sub("", t)
    toks = stripped.split()
    if not toks:
        return False
    return bool(_URL.match(toks[-1]) or _EMAIL.match(toks[-1]))


def classify_unit(text: str, block_kind: str) -> tuple[str, str | None]:
    """Returns (unit_kind, fragment_type).

    unit_kind: 'sentence' | 'fragment'
    fragment_type (fragments only): phone, email, url, nav, button, copyright,
        heading, list_item, lead_in, short, other

    WHAT "SENTENCE" MEANS HERE
    --------------------------
    "Sentence" is shorthand for *a complete thought or idea*. English sentences
    usually map onto that concept, which is why terminal punctuation + length +
    a verb probe are a good proxy. But three corpus realities mean period
    presence must NOT be a hard requirement:

      1. A sentence-final URL/email carries no glued-on period (a trailing '.'
         would alter the resource locator). Editors differ: some end the
         sentence with no period at all ("...at example.com/terms"), others
         add " ." with a space ("...at example.com/terms ."). _ends_in_url_email
         recognizes both conventions as sentence-final.
      2. Contact/opt-out paragraphs routinely drop sentence-final punctuation.
      3. One thought is often stretched across a bulleted <li> list.

    So sentencehood is decided by: substantive length + a finite-verb probe +
    "does not look like chrome / a heading / a lone subordinate clause" + a
    sentence-final URL/email as an independent complete-thought signal.
    This is deliberately conservative in the *fragment* direction: mis-typing a
    heading as a sentence pollutes the sentence view, whereas an over-split
    complete thought remains visible as a typed fragment.
    """
    t = text.strip()
    if not t:
        return ("fragment", "other")
    lower = t.lower()

    # whole-unit chrome patterns
    if _is_phone(t):
        return ("fragment", "phone")
    if _EMAIL.match(t):
        return ("fragment", "email")
    if _URL.match(t):
        return ("fragment", "url")
    if _COPYRIGHT.match(t):
        return ("fragment", "copyright")
    if lower in CHROME_LABELS:
        return ("fragment", "nav" if len(lower.split()) <= 3 else "button")

    words = t.split()
    wc = len(words)
    has_verb = any(w.lower() in VERB_PROBE for w in words)
    has_terminal = bool(re.search(r"[.!?][”\"'）)]*$", t))

    # heading from markup
    if block_kind == "heading":
        return ("fragment", "heading")

    # structural fragment shapes (before sentencehood)
    if _LIST_ITEM_END.search(t):
        # "the right to access;" / "...consent; and" / "...complain or"
        return ("fragment", "list_item")
    if t.endswith(":"):
        return ("fragment", "lead_in")

    # --- heading detection runs BEFORE sentencehood -----------------------
    # Short all-caps strings are section titles even when they contain a verb:
    # "SHARING OF PERSONAL DATA" and "HOW WE COLLECT AND USE INFORMATION" are
    # headings, not sentences. (The verb probe treats gerunds like "sharing"
    # and imperatives like "contact" as verbs, so we deliberately do NOT exempt
    # verb-bearing all-caps text -- a rare all-caps imperative misread as a
    # heading fragment is far less harmful than flooding the sentence view.)
    if _NUMBERED_HEADING.match(t) or _ROMAN_HEADING.match(t):
        return ("fragment", "heading")
    if _ALLCAPS_SHORT.match(t) and wc <= 10:
        return ("fragment", "heading")
    # short capitalized title with terminal punctuation (e.g. "Personal Data.")
    if has_terminal and wc <= 4 and not has_verb and t[0].isupper():
        return ("fragment", "heading")
    if wc <= 3 and not has_terminal:
        return ("fragment", "short")

    # --- subordinate-clause guard -----------------------------------------
    # A lone subordinate clause is not a complete thought, even when it ends
    # in a URL ("When you visit https://x.com"). A comma signals the main
    # clause follows ("If you have questions, please contact us").
    if _SUBORDINATE_START.match(t) and "," not in t:
        return ("fragment", "other")

    # --- URL/email-final complete thought ----------------------------------
    # A sentence-final URL/email is an independent complete-thought signal that
    # the verb probe may miss ("please visit ...", "please see ..."). Editors
    # omit a glued-on period after a URL (it would alter the resource locator):
    #   DB_1 convention: "...at example.com/terms"      (no period)
    #   DB_2 convention: "...at example.com/terms ."    (space, then period)
    # See _ends_in_url_email. This must run BEFORE the generic no-verb heading
    # heuristic below, or verbless URL-final sentences get lost as "heading".
    if wc >= 4 and _ends_in_url_email(t):
        return ("sentence", None)

    # short title-case titles without a verb and without punctuation
    # (e.g. "Effective Date") -- not URL-final (handled above)
    if (not has_terminal and not has_verb
            and not _has_finite_verb_signal(t) and wc <= 8):
        return ("fragment", "heading")

    # --- complete-thought sentencehood ------------------------------------
    # VERB_PROBE is a curated wordlist with inherent gaps ("pledges",
    # "conduct", "recommend", ...). The structural finite-verb signal catches
    # those without growing the wordlist: "we MAY need", "WE recommend".
    if wc >= 4 and (has_verb or _has_finite_verb_signal(t)):
        return ("sentence", None)

    return ("fragment", "other")


def extract_units(html: str) -> list[dict]:
    """End-to-end: HTML -> ordered list of units in document order.

    Each unit carries {unit_kind, fragment_type, text, block_kind, block_seq},
    where block_seq is the index of the containing block (paragraph/heading/
    list) and block_kind its type -- so the original block structure of the
    document can be reconstructed for a faithful "print to pdf" rendering.
    """
    units: list[dict] = []
    for block_seq, block in enumerate(extract_blocks(html)):
        for sent in split_sentences(block["text"]):
            kind, ftype = classify_unit(sent, block["kind"])
            units.append({
                "unit_kind": kind,
                "fragment_type": ftype,
                "text": sent,
                "block_kind": block["kind"],
                "block_seq": block_seq,
            })
    return units


# ---------------------------------------------------------------------------
# 4. Deterministic annotation alignment (ported from the parser's 3-tier logic)
# ---------------------------------------------------------------------------

def normalize_text(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\xa0", " ").replace("\t", " ")
    for orig, repl in {"“": '"', "”": '"', "‘": "'", "’": "'", "`": "'",
                       "–": "-", "—": "-"}.items():
        text = text.replace(orig, repl)
    return re.sub(r"\s+", " ", text).strip().lower()


def load_annotations(csv_path: str) -> list[dict]:
    annotations = []
    if not os.path.exists(csv_path):
        return annotations
    with open(csv_path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for row_idx, row in enumerate(reader):
            text_orig = row.get("Text", "")
            label = row.get("Label", "").strip()
            if not text_orig or not label:
                continue
            norm = normalize_text(text_orig)
            if not norm:
                continue
            annotations.append({
                "src_row": row_idx,
                "ranumb": row.get("RANumb", "").strip(),
                "text": text_orig,
                "normalized": norm,
                "label": label,
                "source_csv": csv_path,
            })
    return annotations


def align_annotations(units: list[dict], annotations: list[dict]):
    """Returns (aligned, unmatched, ambiguous).

    aligned:   list of (annotation_dict, unit_id, alignment_type)
    unmatched: list of annotation dicts
    ambiguous: list of (annotation_dict, [unit_id, ...])
    """
    unit_norms = [normalize_text(u["text"]) for u in units]
    unit_tokens = [set(n.split()) for n in unit_norms]

    aligned: list[tuple] = []
    unmatched = []
    ambiguous = []

    for ann in annotations:
        ann_norm = ann["normalized"]
        ann_tokens = set(ann_norm.split())

        # Case A: sub-sentence fragment contained in a single unit
        case_a = [i for i, n in enumerate(unit_norms) if n and ann_norm in n]
        if len(case_a) == 1:
            aligned.append((ann, units[case_a[0]]["id"], "annotation_in_sentence"))
            continue
        if len(case_a) > 1:
            ambiguous.append((ann, [units[i]["id"] for i in case_a]))
            continue

        # Case B: whole unit(s) contained inside the annotation paragraph span
        case_b = [i for i, n in enumerate(unit_norms)
                  if n and len(n) > 10 and n in ann_norm]
        if case_b:
            for i in case_b:
                aligned.append((ann, units[i]["id"], "sentence_in_annotation_paragraph"))
            continue

        # Case C: partial token overlap across a sentence boundary
        if len(ann_tokens) >= 3:
            best_i, best_overlap = None, 0.0
            for i, s_tokens in enumerate(unit_tokens):
                if not s_tokens:
                    continue
                inter = ann_tokens.intersection(s_tokens)
                if inter:
                    ov = len(inter) / len(ann_tokens)
                    if ov > best_overlap and ov >= 0.55:
                        best_overlap, best_i = ov, i
            if best_i is not None:
                aligned.append((ann, units[best_i]["id"], "partial_overlap"))
                continue

        unmatched.append(ann)

    return aligned, unmatched, ambiguous