"""Prototype of the proposed path (spec §4, docs/superpowers/specs/2026-10-29-document-analysis-design.md): the
browser's candidate finder, the query string it would send, the server's /parse_query resolution (resolve_alias ->
parse_nl_query), then the browser's inheritance.

Run with the visualex venv, from services/visualex:  python -I proposed.py <plain dir> <out.json>
Not the shipped code: a faithful sketch of the span rules, to measure them.
"""
import json, re, sys
from pathlib import Path

sys.path.insert(0, ".")
from visualex_api.tools.alias_resolver import resolve_alias, get_all_presets  # noqa: E402
from visualex_api.tools.nl_parser import parse_nl_query, build_eu_act_pattern  # noqa: E402
from visualex_api.tools.act_resolver import known_act_names  # noqa: E402
from visualex_api.tools.article_suffixes import ARTICLE_SUFFIX_ALTERNATION  # noqa: E402

# The types that name an act only with a number (spec §4.4: one table, shared with the linker's _NUMBERED_ACT_TYPES).
NUMBERED = {"legge", "decreto legge", "decreto legislativo", "decreto del presidente della repubblica", "regio decreto",
            "decreto ministeriale", "regolamento ue", "direttiva ue", "legge costituzionale", "regio decreto legge",
            "decreto legislativo luogotenenziale", "decreto del presidente del consiglio dei ministri"}


def resolve(query: str):
    """/parse_query, as app.py runs it."""
    a = resolve_alias(query)
    if a:
        return a
    p = parse_nl_query(query)
    return p.to_api_params() if p else None


def identifies_act(r):
    """§4.4: a type that needs no number, or a type with its number; case folded ('Regolamento UE')."""
    return bool(r and r.get("act_type") and (r["act_type"].lower() not in NUMBERED or r.get("act_number")))


# --- the vocabulary the browser would download (spec §4.2): every name the server resolves to an identified act
names = set(known_act_names()) | set(get_all_presets())
vocab = []
for n in names:
    n = n.strip()
    if len(n) < 2 or n.isdigit():
        continue
    if identifies_act(resolve(n)):
        vocab.append(n)
vocab.sort(key=len, reverse=True)


def name_src(n):
    parts = [re.escape(p) for p in re.split(r"\s+", n)]
    s = r"\s+".join(parts).replace("'", "['’]")
    # a dot may be followed by a space or not: «cod. civ.», «cod.civ.»
    s = s.replace(r"\.\s+", r"\.\s*")
    return s


VOCAB_SRC = "(?:" + "|".join(name_src(n) for n in vocab) + r")(?![\w])"

MONTHS = "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre"
TYPE_WORD = (r"(?:legge(?:\s+costituzionale)?|l\.\s*cost\.|l\.|d\.\s*lgs\.?|decreto\s+legislativo|d\.\s*l\.|decreto[-\s]legge|"
             r"d\.\s*p\.\s*r\.|decreto\s+del\s+presidente\s+della\s+repubblica|r\.\s*d\.|regio\s+decreto|d\.\s*m\.|decreto\s+ministeriale)")
DATE = r"(?:\d{1,2}\s*[°º]?\s+(?:" + MONTHS + r")\s+\d{4}|\d{1,2}/\d{1,2}/\d{4})"
NUM_FORMS = (r"(?:"
             r"(?:n\.\s*)?\d+\s*/\s*(?:\d{4}|\d{2})\b"                      # 241/1990, n. 241/90
             r"|n\.\s*\d+\s+del\s+(?:" + DATE + r"|\d{4})"                  # n. 241 del 1990, n. 241 del 7 agosto 1990
             r"|" + DATE + r"\s*,?\s*n\.\s*\d+"                            # 7 agosto 1990, n. 241
             r")")
NUMBERED_ACT = TYPE_WORD + r"\s*" + NUM_FORMS
EU_ACT = build_eu_act_pattern()
ACT_PHRASE = r"(?:" + EU_ACT + r"|" + NUMBERED_ACT + r"|" + VOCAB_SRC + r")"

SUF = r"(?:\s*-?\s*(?:" + ARTICLE_SUFFIX_ALTERNATION + r")\b)?"
# «art.», «artt.», «articolo», «articoli»; «art» with no dot only before a digit («art 2043 c.c.»)
ART_HEAD = r"(?<![A-Za-zÀ-ÿ])(?:artt?\.\s*|artt?\s+(?=\d)|articol[oi]\s+)"
# a number with its suffix, or a range («1362-1371»)
ART_ITEM = r"\d+" + SUF + r"(?:\s*-\s*\d+" + SUF + r")?"
ART_LIST = ART_ITEM + r"(?:\s*(?:,|\be\b)\s*" + ART_ITEM + r")*(?:\s+e\s+(?:ss|segg|seguenti)\.?)?"
ORD = r"(?:primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo|nono|decimo)"
CLAUSE = (r"(?:\s*,?\s*(?:"
          r"(?:comm[ai]|co\.|par\.|parr\.|paragraf[oi])\s*\d+" + SUF + r"(?:\s*(?:,|\be\b)\s*\d+" + SUF + r")*"
          r"|" + ORD + r"\s+comma"
          r"|(?:lett\.|lettera|lettere)\s*[a-z](?:\.\d+)?\)?(?:\s*(?:,|ed?)\s*[a-z]\))*"
          r"|nn?\.\s*\d+"
          r"))*")
SEP = r"(?:\s*,\s*|\s+)(?:(?:del|della|dello|dei|degli|delle)\s+|dell['’]\s*)?"

# Named groups: ACT_PHRASE holds the EU pattern's own five groups.
ART_FIRST = re.compile(ART_HEAD + r"(?P<list>" + ART_LIST + r")" + CLAUSE + SEP + r"(?P<act>" + ACT_PHRASE + r")", re.I)
ACT_FIRST = re.compile(r"(?<![\w.])(?P<act>" + ACT_PHRASE + r")\s*,?\s*" + ART_HEAD + r"(?P<list>" + ART_LIST + r")" + CLAUSE, re.I)
ACT_ONLY = re.compile(r"(?<![\w.])(?P<act>" + ACT_PHRASE + r")", re.I)
BARE = re.compile(ART_HEAD + r"(?P<list>" + ART_LIST + r")" + CLAUSE, re.I)
# §4.3: an act named alone becomes context only when it is numbered or EU, or a name that opens with an act word —
# never a short acronym («CTU», «CAP», «TUA» are also words of a brief) nor a subject («smart working»).
CONTEXT_PHRASE = re.compile(r"(?:" + EU_ACT + r"|" + NUMBERED_ACT + r")$", re.I)
ACT_WORD = re.compile(r"^(?:codice|cod\.|legge|l\.|decreto|testo\s+unico|t\.\s*u\.|tu\s|regolamento|direttiva|statuto|disp\.|ordinamento)", re.I)
# What follows a bare article: «del medesimo decreto» inherits; «del contratto» names something else.
SAME = re.compile(r"^\s*,?\s*(?:del|della|dello)\s+(?:medesim[oa]|stess[oa]|citat[oa]|predett[oa]|suddett[oa])\b", re.I)
OTHER_OF = re.compile(r"^\s*,?\s*(?:del|della|dello|dei|degli|delle|dell['’])\s*\S", re.I)
OTHER = re.compile(r"^\s*,?\s*(?:(?:del|della|dello|dei|degli|delle|dell['’])\s*\S|[A-Z]|[a-z]{1,4}\.)")


def articles_of(list_text):
    list_text = re.sub(r"\s+e\s+(?:ss|segg|seguenti)\.?$", "", list_text.strip(), flags=re.I)
    out = []
    for a in re.split(r"\s*(?:,|\be\b)\s*", list_text):
        if a:
            a = re.sub(r"\s+", "", a)
            out.append(re.sub(r"^(\d+)-?([a-z]+)$", r"\1-\2", a, flags=re.I).lower())
    return out


def scan(text):
    used = [False] * len(text)
    cands = []

    def free(a, b):
        return not any(used[a:b])

    def take(a, b):
        for i in range(a, b):
            used[i] = True

    for kind, rx in (("art_first", ART_FIRST), ("act_first", ACT_FIRST)):
        for m in rx.finditer(text):
            if not free(m.start(), m.end()):
                continue
            lst, act = m.group("list"), m.group("act")
            if kind == "act_first":
                # §4.3: the act before an article is held to the context rule, and an article that goes on with
                # «del contratto» belongs to that, not to the act before it
                if not (CONTEXT_PHRASE.match(act) or ACT_WORD.match(act)):
                    continue
                if OTHER_OF.match(text[m.end():m.end() + 60]):
                    continue
            arts = articles_of(lst)
            # the query: what a user types in the search bar — the clause and the preposition left out (§4.3)
            query = "art. " + " e ".join(arts) + " " + re.sub(r"\s+", " ", act).strip()
            cands.append({"kind": kind, "start": m.start(), "end": m.end(), "query": query, "articles": arts})
            take(m.start(), m.end())
    for m in ACT_ONLY.finditer(text):
        a, b = m.start("act"), m.end("act")
        if not free(a, b):
            continue
        g = m.group("act")
        if not (CONTEXT_PHRASE.match(g) or ACT_WORD.match(g)):
            continue
        cands.append({"kind": "act", "start": a, "end": b, "query": re.sub(r"\s+", " ", g).strip(), "articles": []})
        take(a, b)
    for m in BARE.finditer(text):
        if not free(m.start(), m.end()):
            continue
        tail = text[m.end():m.end() + 60]
        cands.append({"kind": "bare", "start": m.start(), "end": m.end(), "query": None, "articles": articles_of(m.group("list")),
                      "same": bool(SAME.match(tail)), "other": bool(OTHER.match(tail)) and not SAME.match(tail)})
        take(m.start(), m.end())
    cands.sort(key=lambda c: c["start"])
    return cands


def paragraph_of(text, pos):
    """§4.6: a paragraph is a line — a DOCX and (after PR 2) an HTML reader end each block with one line break."""
    return text.count("\n", 0, pos)


def run(text, scope):
    preds, queries = [], []
    context = None  # (act dict, paragraph)
    for c in scan(text):
        if c["query"]:
            queries.append(c["query"])
            r = resolve(c["query"])
            if identifies_act(r):
                act = {k: r.get(k) for k in ("act_type", "act_number", "date")}
                context = (act, paragraph_of(text, c["start"]))
                arts = [a.strip() for a in (r.get("article") or "").split(",") if a.strip()] if c["articles"] else []
                if c["articles"] and not arts:
                    arts = c["articles"]
                for a in arts or [None]:
                    preds.append({"start": c["start"], "end": c["end"], "article": a, **act, "state": "found"})
            else:
                for a in c["articles"] or [None]:
                    preds.append({"start": c["start"], "end": c["end"], "article": a, "state": "incomplete", "query": c["query"]})
            continue
        # a bare article
        inherit = None
        if context and not c["other"]:
            same_par = context[1] == paragraph_of(text, c["start"])
            if scope == "document" or same_par or c["same"]:
                inherit = context[0]
        for a in c["articles"]:
            if inherit:
                preds.append({"start": c["start"], "end": c["end"], "article": a, **inherit, "state": "inherited"})
            else:
                preds.append({"start": c["start"], "end": c["end"], "article": a, "state": "incomplete"})
    return preds, queries


if __name__ == "__main__":
    src, dest = Path(sys.argv[1]), Path(sys.argv[2])
    out = {}
    allq = []
    for scope in ("paragraph", "document"):
        out[scope] = {}
        for f in sorted(src.glob("*.txt")):
            preds, queries = run(f.read_text(encoding="utf-8"), scope)
            out[scope][f.name] = preds
            if scope == "paragraph":
                allq += queries
    out["queries"] = allq
    out["vocab_size"] = len(vocab)
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("vocab", len(vocab), "queries", len(allq), "unique", len(set(allq)), "max len", max(map(len, allq)))
