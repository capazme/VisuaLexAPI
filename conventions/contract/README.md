# The core's contract

What the web app and the MCP server hold as hand-made copies of values the core (the server and the
Python API) owns, written down once so that a test can tell when a copy drifted without reading the
core's source files.

| File | What | Source |
| --- | --- | --- |
| `pins.json` | the password rule, the API's page ceiling, the codes table, the annexed acts and their sigle and headings, the decision kinds' families, the article ordinal suffixes | `apps/server/src/utils/password.ts`, `services/visualex/visualex_api/tools/{config,map,article_suffixes}.py`, `services/visualex/visualex_api/services/decisions/model.py` |
| `frozen_projections.json` | the SHA-256 and length of each decision reader's projection, byte for byte | `services/visualex/tests/fixtures/decisions/frozen_projections.json` |

Both files are generated: `node scripts/contract/build.mjs` writes them, `--check` writes nothing and
exits 1 naming the stale one. Never edit them by hand, and never re-record the frozen projections to
make a test pass (rule 23 of the root `CLAUDE.md`: the golden is the core's, this is its copy).

Regenerate and commit the result in the same change that touches one of the sources above;
`node --test 'scripts/contract/*.test.mjs'` (the `tooling` job of CI) fails while a file is stale.

Who reads what:

- the web tests read `pins.json` (`passwordRule`, `dossierUtils`, `sources/golden`, `adminCourts`,
  `articleSuffixes.pins`) and `frozen_projections.json` (`decisionRender`), finding them by walking
  up to the folder that holds `conventions/contract/`;
- the core's own tests keep reading their sources and the original golden; they do not read this
  folder.
