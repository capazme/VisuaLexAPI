# Measuring «Analizza documento» (spec `2026-10-29-document-analysis-design.md`, §3)

A measuring sketch, not product code: it is how the table of §3.2 was made, so anyone can make it again. PR 2 of the
spec replaces it with tests in the web suite. It makes no request and starts no service.

- `../corpus/*.txt` — six invented documents, each expected citation marked in place:
  `[[as written|act type|number|year|articles|flag]]`, the articles comma-separated, the flag `act` (an act named
  without an article), `ctx` (a bare article whose act the context gives) or `out` (outside VisuaLex's sources).
- `corpus.py` — turns the marked corpus into plain texts and `*.expected.json`.
- `today.test.ts` — today's matcher as the page calls it (no norm in reading), and the client parser's reading of
  the proposed path's query strings.
- `proposed.py` — the proposed path: the browser's candidates (§4.3), each query string resolved as `/parse_query`
  resolves it (`resolve_alias`, then `parse_nl_query`), the inheritance (§4.6) within the paragraph and across the
  document.
- `score.py` — scores each path against the corpus (`-v` lists every citation not found), and compares the client
  parser with the server on the strings both read.

From the repository's root, with the web packages installed and the visualex venv in place
(`services/visualex/.venv`):

```bash
SPEC=docs/superpowers/specs/2026-10-29-document-analysis
OUT=$(mktemp -d)                      # anywhere outside the repository
python3 -I $SPEC/measure/corpus.py $SPEC/corpus $OUT/plain
(cd services/visualex && .venv/bin/python -I ../../$SPEC/measure/proposed.py $OUT/plain $OUT/proposed.json)
cp $SPEC/measure/today.test.ts apps/web/src/zz_measure.test.ts
(cd apps/web && MEASURE_DIR=$OUT npx vitest run src/zz_measure.test.ts)
rm apps/web/src/zz_measure.test.ts
(cd services/visualex && .venv/bin/python -I ../../$SPEC/measure/score.py $OUT)
```

The counts are per article: «artt. 1223 e 1225 c.c.» is two citations. A citation is found when a mark overlaps it
with the same article and the same act (a code by its name, any other act by type, number and year).
