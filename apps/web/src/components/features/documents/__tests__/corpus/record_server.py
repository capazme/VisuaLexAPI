"""Records the server's answers that «Analizza documento»'s corpus test replays (documentCorpus.test.ts).

The test makes no request: it reads `server.json` beside this file — the catalog's `act_names` and the answers of
`/parse_query_batch` for every query string the corpus sends — exactly as the API computes them
(`read_norm_query`, `identifies_act`, `act_names`; tables only, no network). Record again when the API's tables or
the candidate rules change; the test names the query strings it lacks.

From the repository's root, with the visualex venv in place:

    W=apps/web/src/components/features/documents/__tests__/corpus
    # 1. the names (the queries depend on them)
    (cd services/visualex && .venv/bin/python -I ../../$W/record_server.py ../../$W/server.json)
    # 2. the queries the corpus sends, then their answers
    (cd apps/web && RECORD_QUERIES=$PWD/../../$W/queries.json npx vitest run documentCorpus)
    (cd services/visualex && .venv/bin/python -I ../../$W/record_server.py ../../$W/server.json ../../$W/queries.json)
    rm $W/queries.json
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")
from visualex_api.tools.act_identity import identifies_act  # noqa: E402
from visualex_api.tools.norm_query import act_names, read_norm_query  # noqa: E402


def answer(query: str) -> dict:
    """One result of /parse_query_batch (app.py `_read_norm_queries`)."""
    params, source = read_norm_query(query)
    return {"recognized": params is not None, "parsed": params, "source": source, "identifies_act": identifies_act(params)}


if __name__ == "__main__":
    out = Path(sys.argv[1])
    queries = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")) if len(sys.argv) > 2 else []
    recorded = {
        "note": "Recorded by record_server.py from the API's own functions; replayed by documentCorpus.test.ts.",
        "act_names": act_names(),
        "answers": {q: answer(q) for q in sorted(set(queries))},
    }
    out.write_text(json.dumps(recorded, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(recorded['act_names'])} names, {len(recorded['answers'])} answers")
