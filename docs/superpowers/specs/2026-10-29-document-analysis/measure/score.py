"""Scores predictions against the corpus. Run with the visualex venv from services/visualex (for the code table
and the linker reference):  python -I score.py <measure dir>"""
import json, sys
from pathlib import Path

sys.path.insert(0, ".")
from visualex_api.tools.map import NORMATTIVA_URN_CODICI  # noqa: E402
from visualex_api.tools.citation_linker import extract_citations  # noqa: E402

CODES = {k.lower() for k in NORMATTIVA_URN_CODICI} | {"tue", "tfue", "cdfue", "cedu"}
D = Path(sys.argv[1])


def key(t, n, d):
    t = (t or "").lower().strip()
    if t in CODES:
        return "code:" + t
    return f"{t}|{(n or '').strip()}|{(d or '')[:4]}"


def norm_art(a):
    return (a or "").lower().replace(" ", "")


def overlaps(a, b):
    return a["start"] < b["end"] and b["start"] < a["end"]


def score(expected, preds):
    r = {"found": 0, "inherited_ok": 0, "wrong": 0, "incomplete": 0, "missed": 0, "spurious": 0, "noise": 0,
         "acts_found": 0, "acts": 0, "out": 0, "detail": []}
    used = set()
    for e in expected:
        if e["flag"] == "out":
            r["out"] += 1
            continue
        if e["flag"] == "act":
            r["acts"] += 1
            k = key(e["act_type"], e["act_number"], e["date"])
            hit = [i for i, p in enumerate(preds) if overlaps(e, p) and p.get("state") != "incomplete"
                   and key(p.get("act_type"), p.get("act_number"), p.get("date")) == k]
            used.update(i for i, p in enumerate(preds) if overlaps(e, p))
            if hit:
                r["acts_found"] += 1
            continue
        k = key(e["act_type"], e["act_number"], e["date"])
        for art in e["articles"]:
            over = [(i, p) for i, p in enumerate(preds) if overlaps(e, p)]
            used.update(i for i, _ in over)
            same_art = [p for _, p in over if norm_art(p.get("article")) == norm_art(art)]
            ok = [p for p in same_art if p.get("state") != "incomplete" and key(p.get("act_type"), p.get("act_number"), p.get("date")) == k]
            if ok:
                r["found"] += 1
                if ok[0].get("state") == "inherited":
                    r["inherited_ok"] += 1
                outcome = "found"
            elif any(p.get("state") == "incomplete" for p in same_art):
                r["incomplete"] += 1
                outcome = "incomplete"
            elif [p for _, p in over if p.get("state") != "incomplete"]:
                r["wrong"] += 1
                outcome = "wrong"
            else:
                r["missed"] += 1
                outcome = "missed"
            r["detail"].append((outcome, e["text"], art, [(p.get("act_type"), p.get("act_number"), p.get("date"), p.get("article"), p.get("state")) for _, p in over]))
    for i, p in enumerate(preds):
        if i in used:
            continue
        if p.get("state") == "incomplete":
            r["noise"] += 1
            r["detail"].append(("noise", p.get("query") or "", p.get("article"), p["start"]))
        elif p.get("article") is None:
            r["extra_acts"] = r.get("extra_acts", 0) + 1
            r["detail"].append(("extra_act", (p.get("act_type"), p.get("act_number")), p["start"]))
        else:
            r["spurious"] += 1
            r["detail"].append(("spurious", (p.get("act_type"), p.get("act_number"), p.get("article")), p["start"], p.get("text", "")))
    return r


def today_preds(lst):
    return [{**p, "state": "found"} for p in lst]


def linker_preds(text):
    out = []
    for c in extract_citations(text):
        if not c.act_type:
            out.append({"start": c.start, "end": c.end, "article": c.article, "state": "incomplete"})
            continue
        arts = (c.article or "").split(",") if c.article else [None]
        for a in arts:
            out.append({"start": c.start, "end": c.end, "article": a, "act_type": c.act_type,
                        "act_number": c.act_number, "date": c.date, "state": "found", "text": c.display_text})
    return out


today = json.loads((D / "today.json").read_text())
proposed = json.loads((D / "proposed.json").read_text())
runs = {"today (the page, extractCitations)": lambda f, t: today_preds(today[f]),
        "server linker on the whole text (reference)": lambda f, t: linker_preds(t),
        "proposed, inheritance within the paragraph": lambda f, t: proposed["paragraph"][f],
        "proposed, inheritance across the document": lambda f, t: proposed["document"][f]}
totals = {}
verbose = "-v" in sys.argv
for name, get in runs.items():
    tot = {}
    for ef in sorted((D / "plain").glob("*.expected.json")):
        f = ef.name.replace(".expected.json", ".txt")
        text = (D / "plain" / f).read_text(encoding="utf-8")
        r = score(json.loads(ef.read_text()), get(f, text))
        if verbose:
            print("==", name, f)
            for d in r["detail"]:
                if d[0] != "found":
                    print("  ", d)
        for k, v in r.items():
            if k != "detail":
                tot[k] = tot.get(k, 0) + v
    totals[name] = tot
for name, t in totals.items():
    print(f"{name}: {t}")

# The client parser against the server on the same strings (§3.2): where both read a string, do they agree?
cq = D / "client_queries.json"
if cq.exists():
    sys.path.insert(0, str(Path(__file__).parent))
    from proposed import resolve  # noqa: E402

    def flat(x):
        return ((x.get("act_type") or "").lower(), x.get("act_number") or "", (x.get("date") or "")[:4],
                (x.get("article") or "").replace(" ", ""))
    readings = json.loads(cq.read_text())
    ready = [q for q, v in readings.items() if v["ready"]]
    differ = [(q, flat(readings[q]["parsed"]), flat(resolve(q) or {})) for q in ready
              if flat(readings[q]["parsed"]) != flat(resolve(q) or {})]
    print(f"client parser: {len(ready)} of {len(readings)} strings searchable in the browser; differing from the server: {len(differ)}")
    for d in differ:
        print("  ", d)

