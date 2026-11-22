# The core's contract

What the web app and the MCP server hold as hand-made copies of values the core (the server and the
Python API) owns, written down once so that a test can tell when a copy drifted without reading the
core's source files.

| File | What | Source |
| --- | --- | --- |
| `pins.json` | the password rule, the API's page ceiling, the codes table, the annexed acts and their sigle and headings, the decision kinds' families, the article ordinal suffixes | `apps/server/src/utils/password.ts`, `services/visualex/visualex_api/tools/{config,map,article_suffixes}.py`, `services/visualex/visualex_api/services/decisions/model.py` |
| `frozen_projections.json` | the SHA-256 and length of each decision reader's projection, byte for byte | `services/visualex/tests/fixtures/decisions/frozen_projections.json` |
| `anchors.json` | rule 23 across repositories: real article texts and synthetic decision texts, each with its projection and the passages the server would store on it | the texts: frozen inputs; the rest: the server's `apps/server/tests/assistant/anchorsContract.ts` |
| `legal-paths.json` | the paths the browser sends to the Python API: what the web's Vite config proxies in development and the ingress routes to the scrapers in production | written by hand, with the Python route; the web's `legalPaths.contract.test.ts` holds Vite to it, the core's `infra/ingress/paths.test.mjs` the Caddyfile |

`pins.json` and `frozen_projections.json` are generated: `node scripts/contract/build.mjs` writes them, `--check` writes nothing and
exits 1 naming the stale one. Never edit them by hand, and never re-record the frozen projections to
make a test pass (rule 23 of the root `CLAUDE.md`: the golden is the core's, this is its copy).

Regenerate and commit the result in the same change that touches one of the sources above;
`node --test 'scripts/contract/*.test.mjs'` (the `tooling` job of CI) fails while a file is stale.

Who reads what:

- the web tests read `pins.json` (`passwordRule`, `dossierUtils`, `sources/golden`, `adminCourts`,
  `articleSuffixes.pins`), `frozen_projections.json` (`decisionRender`), `anchors.json`
  (`anchorsContract`) and `legal-paths.json` (`legalPaths.contract`), finding them by walking up to
  the folder that holds `conventions/contract/`;
- the core's own tests keep reading their sources and the original golden; of this folder they read
  only `anchors.json` (the server's `ruleTwentyThree`, below) and `legal-paths.json` (the ingress's
  `paths.test.mjs`).

## `anchors.json`: rule 23 across repositories

Root rule 23: a highlight or a note is anchored by `(startOffset, text)` in the text's projection, and
the web's renderer drops it silently when the stored text is not the slice at that offset. The server's
assistant proposes passages the web must draw exactly. The two sides meet in this file instead of
importing each other's code:

- `raw` (an article's `article_text`) and `testo` (a decision's blocks) are **inputs, frozen**: the
  web's fixtures `articleTexts.ts` and `decisionTexts.ts` of 22 November 2026, real statutory texts
  and synthetic decisions. They change only in review, never to make a test pass;
- `projection` and `passages` are what the server computes from them: a quote taken at three places,
  located with `locateQuote`, stored as `start` and `text`, or `refused` (`ambiguous` when it repeats);
- the server's `apps/server/tests/assistant/ruleTwentyThree.test.ts` fails unless the file is exactly
  what the server computes, byte for byte; the web's `apps/web/src/utils/__tests__/anchorsContract.test.ts`
  fails unless its renderer draws every stored passage at its start, and its `decisionProjection`
  equals each stored one.

When a server change moves passages, rewrite the computed fields from apps/server:

```sh
npx dotenv -e .env.test -- tsx tests/assistant/writeAnchorsContract.ts
```

then let the web's suite judge the new passages; commit both in the same change. Once the repositories
are split and this folder is a submodule, a rewrite reaches the web when the web moves its submodule
to that commit: the web's suite is the judge then, before the core's release pins that web.

Characters a diff or an editor would hide (no-break spaces and the like) are written as `\u` escapes.
