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
    "identity": { "fields": E, "key": E, "path": E, "reference_path": E },   // reference_path: a reference with no archive, which the page resolves
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
| `decided` | the owner's words exist (quoted in `note` or in the spec) | today: the web suite for norm citations, except the cases still listed in its `PENDING_ADOPTION`; every adopting suite |
| `current` | what the code does today, and the convention keeps it | by the suites that hold that code (today: the API for norm identities and decision keys, the web for decision paths) |
| `proposed` | a low-impact call stated in the spec; the owner can overturn it | once the area adopts the convention |
| `open:Qn` | waits for question n of the spec (§9); the value is the recommendation | once the owner answers and the status flips (none today: the owner answered Q1–Q9 on 4 October 2026) |

`aliases` are other spellings of the same identity (a bare URN, Normattiva's
alias form, a version marker, a malformed type token): the normaliser maps each
to `article`. `legacy_keys` are graph keys that re-key to the decision's `key`.

## Who reads it

Each suite finds the file by walking up from its own test to the directory
holding `conventions/`, and fails when it is not there.

| Suite | Test |
|---|---|
| web | `apps/web/src/utils/__tests__/sourcesGolden.test.ts` (today: shape, decided citations, current decision paths and reference paths) |
| Python API | `services/visualex/tests/test_sources_golden.py` (today: current norm identities, current decision keys) |
| server, MCP, MERL-T | added by each area's adoption PR (plan `docs/superpowers/plans/2026-10-04-source-convention.md`) |

## Changing it

A new case or a changed value is a change of the convention: it goes with the
code that makes the suites green again, in the same pull request. Flipping an
`open` status to `decided` quotes the owner's answer in the `note`.
