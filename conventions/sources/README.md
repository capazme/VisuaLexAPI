# The convention for legal sources

`golden.json` says who a norm or a decision is (its identity) and how VisuaLex
writes it for each use (its labels). It is the specification the owner reads and
the fixture every suite asserts: the web app, the server, the MCP server, the
Python API and MERL-T. Design: `docs/superpowers/specs/2026-10-04-source-convention-design.md`.

## Shape

```jsonc
{
  "version": 1,
  "norms": [{
    "id": "l-241-1990-2",            // unique across the file
    "note": "…",                     // why, in plain words; quotes the owner where he decided
    "input": { "tipo_atto": "legge", "numero_atto": "241", "data": "1990-08-07", "numero_articolo": "2" },
    "identity": { "act": E, "article": E, "aliases": E, "reference": E },   // any subset
    "labels": { "citation": E, "short": E, "act_citation": E, "act_short": E, "act_heading": E, "authority": E }
  }],
  "decisions": [{
    "id": "…", "note": "…",
    "input": { "reference": { "corte": "cassazione", "archivio": "civile", "numero": 31310, "anno": 2024, "sezione": "U" },
               "attributes": { "tipo": "sentenza", "data_deposito": "2024-12-06" }, "rv": ["…"], "legacy_keys": ["…"] },
    "identity": { "fields": E, "key": E, "path": E, "reference_path": E },   // reference_path: a reference with no archive, which the route resolves
    "labels": { "citation": E, "short": E, "short_with_rv": E }
  }]
}
```

`input` is the source as VisuaLex stores it: a norm is a `norma_data` (the
fields the reader and the dossier keep), a decision is a reference with the
attributes the source gave.

Every expected value `E` is `{ "value": …, "status": … }`:

| status | meaning | asserted |
|---|---|---|
| `decided` | the owner's words exist (quoted in `note` or in the spec) | every adopting suite: the web app, the server and the MCP server, the API, MERL-T |
| `current` | what the code does today, and the convention keeps it | by the suites that hold that code (today: the API for norm identities and decision keys, the web for decision paths and `decision_citations`) |
| `proposed` | a low-impact call stated in the spec; the owner can overturn it | once the area adopts the convention |
| `open:Qn` | waits for question n: Q1–Q9 of the convention spec (§9), Q10–Q13 of `docs/superpowers/specs/2026-10-12-decisions-mcp-and-eu-courts-design.md` (§8); the value is the recommendation | once the owner answers and the status flips (the owner answered Q1–Q9 on 4 October 2026 and Q10–Q14 on 12 October 2026: none is open) |

`aliases` are other spellings of the same identity (a bare URN, Normattiva's
alias form, a version marker, a malformed type token): the normaliser maps each
to `article`. `legacy_keys` are graph keys that re-key to the decision's `key`.

## Who reads it

Each suite finds the file by walking up from its own test to the directory
holding `conventions/`, and fails when it is not there.

| Suite | Test |
|---|---|
| web | `apps/web/src/utils/__tests__/sourcesGolden.test.ts` (today: shape, decided citations, current decision paths and reference paths); `apps/web/src/utils/__tests__/decisionCitationParser.test.ts` (`decision_citations`); `apps/web/src/utils/__tests__/decisionCitationMatcher.test.ts` (`decision_citations_in_text`) |
| Python API | `services/visualex/tests/test_sources_golden.py` (today: current norm identities, current decision keys); `services/visualex/tests/test_nl_parser_convention.py` (every citation and short label reads back through the parser to its norm); `services/visualex/tests/test_decision_citation.py` (`decision_citations`, through `/parse_decision`) |
| server, MCP, MERL-T | added by each area's adoption PR (plan `docs/superpowers/plans/2026-10-04-source-convention.md`) |

## Changing it

A new case or a changed value is a change of the convention: it goes with the
code that makes the suites green again, in the same pull request. Flipping an
`open` status to `decided` quotes the owner's answer in the `note`.

## `decision_citations`

A decision as a lawyer writes it, read into the reference `/fetch_decision` takes, or `null`:

```jsonc
"decision_citations": {
  "note": "…", "today": "2026-10-05",          // the reader's clock: a year after it is refused
  "cases": [
    { "input": "Cass. civ., sez. un., n. 31310/2024",
      "reference": { "value": { "corte": "cassazione", "archivio": "civile", "sezione": "U", "numero": 31310, "anno": 2024 }, "status": "current" } },
    { "input": "Cons. Stato, sez. VI, n. 2270/2019",
      "reference": { "value": null, "status": "current" },
      "unsupported_court": { "value": "Consiglio di Stato", "status": "proposed" } }
  ]
}
```

Two parsers read the same words: the web palette's `decisionCitationParser.ts`, on every
keystroke in the browser, and the Python API's `/parse_decision`, which the server's
`POST /dossiers/:id/decisions` calls (Part A of the 12 October design). Each asserts the cases whose status is `decided`, `current` or `proposed` and lists the
open ones as skipped. `unsupported_court` (the court the API names when it recognises one
VisuaLex has no reader for) is the API's alone. The section is kept as written (`III`, `U`), as the palette keeps it.

## `decision_citations_in_text`

The decisions a running text cites, with where they are written: the web's scanner
`apps/web/src/utils/decisionCitationMatcher.ts` (`extractDecisionCitations`) reads a decision's text, an
article's text or a Brocardi section, and returns the spans of the citations it finds.

```jsonc
"decision_citations_in_text": {
  "note": "…", "today": "2026-10-05",
  "cases": [
    { "text": "Cass. n. 1234 del 2020; Sez. 1, n. 5 del 2021.", "within": "cassazione",   // within: the court of the text being read
      "spans": [{ "start": 0, "end": 22, "text": "Cass. n. 1234 del 2020",             // UTF-16 offsets of `text`, and the words between them
                  "reference": { "corte": "cassazione", "numero": 1234, "anno": 2020 }, "path": "/sentenze/cassazione/1234/2020" }],
      "status": "decided" }
  ]
}
```

A citation is linked only when its court is written in it; the one context rule (the owner, 13 October
2026) is that, inside a Cassazione decision (`within`), a section written without the court reads as the
Cassazione. A bare number, an act's citation, a court the app cannot open and prose between a court and a
number give no span (`spans: []`). The words are read by the parser behind `decision_citations`; the scan is
the web app's alone, there is no Python twin. Asserted by
`apps/web/src/utils/__tests__/decisionCitationMatcher.test.ts`.

## `tar-seats.json`

The 29 seats of the Tribunali amministrativi regionali, as the portal of giustizia-amministrativa.it
names them, with their region and whether each is the region's main seat
(`docs/superpowers/specs/2026-10-12-administrative-courts-design.md`). A TAR named by its region
alone is read as its main seat; a citation names the seat only where the region has more than one.

## `norm-entries.json`

A norm that comes from someone else — a Forum proposal, a published environment, a file or a
share link — is rebuilt from closed values before it can be cited to its new owner (a known act
type, fixed forms for every cited field, unknown keys dropped). The file holds the inputs and,
for each, the norm kept or the Italian reason it is refused; the server's
`apps/server/src/schemas/normEntry.ts` and the web's `apps/web/src/utils/sources/normEntry.ts`
both assert it.

## `decision-keys.json`

A decision's key (`cassazione:civile:99999:2024`, `corte_costituzionale:99999:2020`) read back to
its identity, or refused: the shapes, the leading zeros, the whitespace, the first year of each
court and the current-year bound (`{currentYear}`, `{nextYear}` stand for the reader's clock). Every
number is fictional. The web's `identityFromKey` and the server's `readDecisionKey` both assert it
(`apps/web/src/utils/__tests__/decisionLinks.key.test.ts`, `apps/server/tests/decisionKey.test.ts`).
