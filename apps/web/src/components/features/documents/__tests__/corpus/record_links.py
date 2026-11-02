"""Records the answers of POST /fetch_norm_links that documentLinksCorpus.test.ts replays.

The test makes no request: it reads `links.json` beside this file — one answer per distinct norm the corpus links.
Unlike `record_server.py` this asks a running Python API (the route reads the act's date and index from Normattiva),
so the answers are what the route said on the day of the recording: record again when the route or the corpus
changes. From the repository's root, with the API running on :5001 (VISUALEX_API_PORT=5001 on a Mac):

    W=apps/web/src/components/features/documents/__tests__/corpus
    (cd apps/web && RECORD_NORMS=$PWD/../../$W/norms.json npx vitest run documentLinksCorpus)
    python3 -I $W/record_links.py http://localhost:5001 $W/norms.json $W/links.json
    rm $W/norms.json

Only the norms are sent, never a text: the corpus is invented anyway.
"""
import json
import sys
import urllib.request
from pathlib import Path


def key(norm: dict) -> str:
    """documentLinks.ts `normKey`."""
    return json.dumps([norm["act_type"].lower(), norm.get("act_number", ""), norm.get("date", ""),
                       norm["article"].lower(), norm.get("annex")], ensure_ascii=False, separators=(",", ":"))


def ask(base: str, norms: list) -> list:
    request = urllib.request.Request(base.rstrip("/") + "/fetch_norm_links", method="POST",
                                     data=json.dumps({"norms": norms}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())["results"]


if __name__ == "__main__":
    base, src, dest = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    norms = json.loads(src.read_text(encoding="utf-8"))
    answers = {}
    for i in range(0, len(norms), 20):
        chunk = norms[i:i + 20]
        for norm, result in zip(chunk, ask(base, chunk)):
            answers[key(norm)] = result
    dest.write_text(json.dumps({"note": "Recorded by record_links.py from a running API; replayed by documentLinksCorpus.test.ts.",
                                "answers": answers}, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(len(answers), "answers;", sum(1 for a in answers.values() if a["reason"] == "ok"), "ok")
