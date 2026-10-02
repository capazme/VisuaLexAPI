# MERL-T graph, phase 1: one vocabulary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every writer and every reader of the MERL-T knowledge graph uses one vocabulary (labels, relation types, text property, URN form, estremi, provenance, fonte, Qdrant ids and source types); the existing graph is migrated to it; reading an article completes it instead of only checking that it exists; the graph is shown to validators only.

**Architecture:** one Python module, `services/merlt/merlt/storage/graph/schema.py`, defines the vocabulary. A static contract test reads every string literal under `services/merlt/merlt/` and fails when a Cypher string names a relation, a label, a `fonte` or a `provenance` the module does not define; its lists of known offenders shrink task by task and end empty. Names built at runtime (maps, lists handed to the graph tool) are pinned by tests of their own, and the graph search tool resolves whatever name a caller passes through the schema. A one-off idempotent script migrates FalkorDB and Qdrant. MERL-T's check-article answers "complete?"; the BFF and the web app restrict the graph to administrators.

**Tech Stack:** Python 3.11 (MERL-T: FastAPI, FalkorDB, qdrant-client, pytest with `asyncio_mode = "auto"`), Node/TypeScript (BFF: Express, Prisma, vitest + supertest + nock), React 19 (vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-09-30-merlt-graph-structure-design.md`, sections 4 and 6.5. Phase 2 (complete ingestion) and the rest of phase 3 get their own plans.

**Amended 1 October** with what the December 2025 experiments (`services/merlt/docs/experiments/`) found: Tasks 1b (indexes, the key of a past version), 5b (an article found by its URN, not its number), 5c (the benchmark counts an article once) and 6b (indexes, integrity checks and a retrieval gate around the migration).

**Amended 2 October** with the rulings of pull request A's reviews: the four tasks above move into pull request B; Task 6 renames relations with `MERGE`, resets the stamps of the old entity writer, reports twins both ways, labels and keys the community entities, re-keys the doubled version keys, drops stale live-source text and wraps bare keys; the controller, not the implementer, migrates the development graph; Task 7 carries the review's notes; a closing section lists what comes after phase 1.

## Global Constraints

- Relation types are **UPPER CASE**. A reference between norms is `RINVIA` (never `CITA`, `cita`, `rinvia`, `richiama`); the structure is `CONTIENE` (partition → partition → article → comma → lettera); a community entity's link to the live source it came from is `DERIVA_DA`.
- Labels keep the seed's names (`Norma`, `Comma`, `AttoGiudiziario`, `ConcettoGiuridico`, …). Partitions and acts are `Norma` nodes told apart by `tipo_documento`, as today.
- The canonical URN is the **full Normattiva URL** with the version marker (`!vig=…`, `!orig=…`, `@originale`) cut at the first `!` or `@`. The URL wrapper is never stripped: it is the seed's key.
- `estremi`: `Art. <numero> <abbreviation>` from the one abbreviation table (`Art. 1 Cost.`, `Art. 1321 c.c.`); for an act the table does not know, `Art. <numero>` plus whatever the writer knows.
- `fonte` values: `Normattiva`, `Brocardi.it`, `manuale:Torrente-libroiv`, `community`, `mcp-legal-it`, `italia_corpus`. `provenance` values: `seed`, `ingestion`, `community_validated`, `live_unconfirmed`, `confirmed`.
- The text of a node is read through `schema.node_text()`; `Norma` carries `testo` (and `testo_vigente` as an alias) plus `testo_sha256`, the SHA-256 of the exact text. The AKN fingerprint (`/fetch_act_fingerprints`, the SHA-256 of the AKN article text) is another property, `akn_sha256`: phase 1 writes none, and it never goes into `testo_sha256` (the two texts never match; `schema.py`, the note above `text_fingerprint`). "Fingerprint" in this plan means `testo_sha256`.
- Qdrant point ids are `uuid5(namespace, "<canonical URN>|<source_type>|<key>")`, never Python `hash()`; `key` is `0` for the one norm/ratio/spiegazione point of an article and the massima's index for a massima.
- `article_text` is a data contract (root `CLAUDE.md`, rule 23): the graph copies the text as it comes and never rewrites it.
- MERL-T tests never touch the development stack's stores. Unit tests, from the repository root: `docker run --rm -v "$PWD/services/merlt:/app" -w /app --entrypoint python visualex-merlt-worker:latest -m pytest <paths> -q -p no:cacheprovider` (the mounted code shadows the image's; the pytest options in `pyproject.toml` exclude `integration`). FalkorDB integration tests use a throwaway `falkordb/falkordb` container on a free port, never `visualex-falkordb`; they reach it through `FALKORDB_HOST`/`FALKORDB_PORT` and write to a graph of their own (`merlt_test_*`). Since capazme/VisuaLexAPI#38, CI runs `-m integration` against a disposable FalkorDB with the same two variables, so every integration test in this plan runs in CI too.
- MERL-T code is baked into its images: before any live check, `docker compose -f infra/compose.yml --profile merlt build merlt-api merlt-worker` and `… up -d --force-recreate merlt-api merlt-worker`.
- Data moves by export and import: `scripts/backup.sh` before the migration touches the development graph.
- Code, comments, commits and docs in English; UI copy in Italian. Nothing private in the repository.
- Git: one branch per pull request, from `develop` (B from A's head, merged with `develop`), Conventional Commits, merge commits titled `merge: <branch> — <what changes>` once CI is green.

Pull requests:

- **A** `refactor/merlt-graph-vocabulary` = Tasks 1–5 and the fixes of its reviews. It is capazme/VisuaLexAPI#39, open as a draft.
- **B** `feat/merlt-graph-migration`, cut from A's head = Tasks 1b, 5b, 5c, 6 and 6b, in that order.
- **A merges only together with B, back to back**, and the controller migrates the development graph at once (Task 6, Step 6). Merged alone, A's readers would miss 16,866 of the seed's 43,936 edges, whose names only the migration changes.
- **C** `feat/merlt-article-completeness` = Task 7, after B **and after the migration has run on the development graph** (otherwise every article reads incomplete and is re-ingested on first view).
- **D** `feat/graph-validators-only` = Task 8, independent of A–C.
- **Task 9** closes the round with the docs.
- CI runs `-m integration` against a disposable FalkorDB since capazme/VisuaLexAPI#38.

## Review Focus

1. **A URN that carries `@originale` or `!vig=…`** (the reader, the tracking payloads and the BFF all produce them) must reach the same node as the bare URL. Pinned by Task 1 (`canonical_urn`), Task 5 (the graph tool's start node) and Task 7 (check-article).
2. **A relation name built at runtime** — a map value, a list handed to the graph tool, an f-string placeholder — is invisible to the static contract test. Pinned by Task 3 (multivigenza map, seed edges), Task 4 (entity-writer map, community relations) and Task 5 (the experts' lists, the graph tool's resolution of legacy and policy names).
3. **The migration run twice, or restarted after a crash half-way,** must converge and change nothing the second time (what it only reports — twins, a key two nodes would share — it reports again). Pinned by Task 6 (FalkorDB integration test, Qdrant in-memory tests, the upsert-then-crash case).
4. **The same article ingested by two processes** must produce the same Qdrant ids (Python's `hash()` is salted per process). Pinned by Task 1 (subprocess test) and Task 3 (the lazy writer's ids).
5. **A non-administrator calling the graph API directly** gets 403 even though the UI hides the graph — while contributors keep the entity search their picker needs; and **an article that stays incomplete** is not re-ingested on every view. Pinned by Task 8 and Task 7.

## Scope notes (what phase 1 leaves out, and why)

- **A page for the Q&A without the graph** (spec 6.5, last sentence). The Q&A lives on `/grafo`; Task 8 hides it together with the graph for non-administrators. A graph-free "Assistente" page is its own UI round, once the owner chooses.
- **Doctrine and vectors in the completeness check** (spec 4.3). Phase 1 checks text, commi, hierarchy and fingerprint. Adding the other two now would re-ingest all 889 seed articles on first view and duplicate their vectors, because seed and lazy points are keyed differently until phase 2 re-ingests.
- **A stored, dated completeness record** (spec 4.3). Phase 1 derives completeness from the graph itself, which cannot go stale; the dated record comes with phase 2, together with the two parts above.
- **Massime and rulings** (spec 5.1) and the full doctrine layer: phase 2. `AttoGiudiziario` is the ruling (the pronuncia) and its massime are attributes of it, as the owner decided (1 October); a ruling is keyed by the identity it shares with the sentenze and massimario rounds (`cassazione:<archivio>:<numero>:<anno>`), and a massima by its ruling's key plus a fingerprint of its text.
- **A massima's point key**: phase 1 keeps the massima's index (Global Constraints); the spec (5.1) keys it on the ruling plus a fingerprint of its text, and phase 2 re-keys those points with a migration of its own.
- **Existing concept twins**: the migration reports them, never merges them (Task 6, `report_twins`); the entity writer merges new ones (Task 4). The development graph has no community twin, and 8 pairs (16 nodes) of seed nodes that are near-duplicates of each other ("La reticenza" / "reticenza").
- **`Dottrina.descrizione`, `AttoGiudiziario.massima`** keep their names; `node_text()` reads them.
- **`RINVIA` in the systemic floor**: it stays a policy-chosen extra until phase 2 writes the references and they can be measured.
- **`ConstitutionalBasisTool`, `CitationChainTool`**: unwired (Task 5); phase 2 can rewire the first on `RINVIA` edges to the Constitution.
- Lazy hierarchy for numbered acts and the multivigenza URNs with spaces: phase 2.

---

### Task 1: The schema module

**Files:**
- Create: `services/merlt/merlt/storage/graph/schema.py`
- Test: `services/merlt/tests/unit/test_graph_schema.py`
- Modify: `services/merlt/merlt/pipeline/mechanical_ingestion/parser.py:125-179` (the abbreviation table and `_code_abbreviation` move out; the old names stay importable)

**Interfaces:**
- Consumes: `merlt.utils.map.NORMATTIVA_URN_CODICI`, `merlt.utils.urn_labels.article_number_from_urn`, `merlt.pipeline.enrichment.models.RelationType` (tests only).
- Produces (later tasks import these names from `merlt.storage.graph.schema`): `Label`, `Rel` (str Enums); `LEGACY_REL: dict[str, Rel]`; `REL_ALIASES: dict[str, Rel]`; `canonical_rel(name: str) -> Rel` (strict, for writers); `resolve_rel(name: str) -> str` and `resolve_rels(names: Iterable[str]) -> list[str]` (lenient, for readers); `community_rel_to_graph(value: str) -> Rel`; `SourceType`; `LEGACY_SOURCE_TYPE: dict[str, SourceType]`; `canonical_source_type(value: str) -> SourceType`; `EXPERT_SOURCE_TYPES: dict[str, list[str]]`; `Provenance`, `Fonte`; `normalize_fonte(value: str | None) -> str | None`; `canonical_urn(urn: str | None) -> str | None`; `CODE_ABBREVIATIONS: dict[str, str]`; `act_abbreviation(act_type: str) -> str`; `format_estremi(numero_articolo: str, act_type: str) -> str`; `act_name_from_urn(urn: str | None) -> str | None`; `estremi_from_urn(urn: str | None) -> tuple[str | None, str | None]`; `stub_properties(urn: str, provenance: Provenance = Provenance.INGESTION) -> dict`; `ARTICLE_COMPLETENESS_PARTS: tuple[str, ...]`; `text_fingerprint(text: str) -> str`; `point_id(article_urn: str, source_type: str, key: str | int = 0) -> str`; `TEXT_PROPERTIES`; `node_text(props: Mapping[str, Any]) -> str`; `SEED_TWIN: dict[str, tuple[Label, str]]`.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/unit/test_graph_schema.py
"""The graph's one vocabulary (merlt/storage/graph/schema.py)."""
import subprocess
import sys

import pytest

from merlt.pipeline.enrichment.models import RelationType
from merlt.storage.graph import schema as s

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
COST = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione~art1"
LEGGE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art5"


@pytest.mark.parametrize("marker", ["!vig=", "!vig=2024-01-01", "@originale", "!orig=1"])
def test_canonical_urn_cuts_only_the_version_marker(marker):
    assert s.canonical_urn(CC + marker) == CC


def test_canonical_urn_keeps_the_url_and_passes_empty_values():
    assert s.canonical_urn(CC) == CC
    assert s.canonical_urn("") == ""
    assert s.canonical_urn(None) is None


def test_every_relation_is_upper_case():
    assert all(r.value == r.value.upper() for r in s.Rel)


@pytest.mark.parametrize("name, canonical", [
    ("contiene", "CONTIENE"), ("interpreta", "INTERPRETA"), ("commenta", "COMMENTA"),
    ("versione_di", "VERSIONE_DI"), ("CITA", "RINVIA"), ("cita", "RINVIA"),
    ("rinvia", "RINVIA"), ("richiama", "RINVIA"), ("DISCIPLINA", "DISCIPLINA"),
])
def test_canonical_rel_maps_graph_names(name, canonical):
    assert s.canonical_rel(name).value == canonical


def test_canonical_rel_refuses_what_the_graph_never_had():
    with pytest.raises(ValueError):
        s.canonical_rel("CONTENUTO_IN")


@pytest.mark.parametrize("asked, meant", [
    ("contiene", "CONTIENE"), ("Disciplina", "DISCIPLINA"), ("cita", "RINVIA"),
    ("deroga", "DEROGA_A"), ("connesso_a", "CORRELATO"),
    ("RIFERIMENTO", "RINVIA"), ("RELATED_TO", "CORRELATO"), ("INTERPRETED_BY", "INTERPRETA"),
    ("default", "default"),  # unknown: unchanged, so a filter on it matches nothing
])
def test_resolve_rel_reads_every_callers_vocabulary(asked, meant):
    assert s.resolve_rel(asked) == meant


def test_resolve_rels_keeps_order_and_drops_repeats():
    assert s.resolve_rels(["cita", "RINVIA", "contiene"]) == ["RINVIA", "CONTIENE"]


def test_every_community_relation_reaches_the_graph():
    for member in RelationType:
        if member.value == "PARTE_DI":
            with pytest.raises(ValueError):
                s.community_rel_to_graph(member.value)
        else:
            assert isinstance(s.community_rel_to_graph(member.value), s.Rel)
    assert s.community_rel_to_graph("CITA") is s.Rel.RINVIA


def test_source_types_and_what_each_expert_reads():
    assert s.canonical_source_type("concettogiuridico") is s.SourceType.CONCETTO
    assert s.canonical_source_type("principiogiuridico") is s.SourceType.CONCETTO
    assert s.canonical_source_type("massima") is s.SourceType.MASSIMA
    assert s.canonical_source_type("text") is s.SourceType.TEXT
    assert s.EXPERT_SOURCE_TYPES["literal"] == ["norma", "comma"]
    assert s.EXPERT_SOURCE_TYPES["systemic"] == ["norma", "comma"]
    assert s.EXPERT_SOURCE_TYPES["principles"] == ["ratio", "spiegazione", "dottrina", "concetto"]
    assert s.EXPERT_SOURCE_TYPES["precedent"] == ["massima"]


@pytest.mark.parametrize("raw, fonte", [
    ("VisualexAPI", "Normattiva"), ("Normattiva", "Normattiva"), ("Brocardi", "Brocardi.it"),
    ("brocardi.it", "Brocardi.it"), ("community_validation", "community"),
    ("manuale:Torrente-libroiv", "manuale:Torrente-libroiv"), ("italia_corpus", "italia_corpus"),
    ("una fonte nuova", "una fonte nuova"), (None, None),
])
def test_normalize_fonte(raw, fonte):
    assert s.normalize_fonte(raw) == fonte


def test_estremi_use_the_one_abbreviation_table():
    assert s.format_estremi("2043", "codice civile") == "Art. 2043 c.c."
    assert s.format_estremi("2043", "Codice  Civile") == "Art. 2043 c.c."
    assert s.format_estremi("1", "Costituzione") == "Art. 1 Cost."
    assert s.format_estremi("33", "codice del consumo") == "Art. 33 cod. cons."
    assert s.format_estremi("3", "legge sulla privacy") == "Art. 3 legge sulla privacy"


def test_the_act_is_read_from_the_urn_only_for_known_codes():
    assert s.act_name_from_urn(CC + "!vig=") == "codice civile"
    assert s.act_name_from_urn(COST) == "costituzione"
    assert s.act_name_from_urn(LEGGE) is None
    assert s.estremi_from_urn(CC) == ("2043", "Art. 2043 c.c.")
    assert s.estremi_from_urn(COST) == ("1", "Art. 1 Cost.")
    assert s.estremi_from_urn(LEGGE) == ("5", "Art. 5")
    assert s.estremi_from_urn(CC.split("~")[0]) == (None, None)


def test_the_one_stub_shape():
    assert s.stub_properties(CC + "@originale") == {
        "URN": CC, "node_id": CC, "numero_articolo": "2043", "estremi": "Art. 2043 c.c.",
        "is_stub": True, "provenance": "ingestion",
    }
    act = CC.split("~")[0]
    assert s.stub_properties(act) == {"URN": act, "node_id": act, "is_stub": True, "provenance": "ingestion"}


def test_point_ids_are_the_same_in_every_process():
    here = s.point_id(CC, "massima", 3)
    code = f"from merlt.storage.graph.schema import point_id; print(point_id({CC!r}, 'massima', 3))"
    there = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True).stdout.strip()
    assert here == there
    assert here != s.point_id(CC, "massima", 4)
    assert s.point_id(CC + "!vig=", "norma") == s.point_id(CC, "norma")


def test_text_fingerprint_is_sha256_of_the_exact_text():
    assert s.text_fingerprint("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    assert s.text_fingerprint("abc ") != s.text_fingerprint("abc")


def test_node_text_reads_every_writers_property():
    assert s.node_text({"testo": "a", "testo_vigente": "b"}) == "a"
    assert s.node_text({"testo_vigente": "b"}) == "b"
    assert s.node_text({"text": "c"}) == "c"
    assert s.node_text({"massima": "d"}) == "d"
    assert s.node_text({"descrizione": "e"}) == "e"
    assert s.node_text({"testo": "  ", "descrizione": "e"}) == "e"
    assert s.node_text({}) == ""


def test_seed_twins_by_entity_type():
    assert s.SEED_TWIN["concetto"] == (s.Label.CONCETTO_GIURIDICO, "concetto")
    assert s.SEED_TWIN["soggetto_giuridico"] == (s.Label.SOGGETTO_GIURIDICO, "soggetto")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker run --rm -v "$PWD/services/merlt:/app" -w /app --entrypoint python visualex-merlt-worker:latest -m pytest tests/unit/test_graph_schema.py -q -p no:cacheprovider`
Expected: FAIL — `ImportError: cannot import name 'schema' from 'merlt.storage.graph'`.

- [ ] **Step 3: Write the module**

```python
# services/merlt/merlt/storage/graph/schema.py
"""The one vocabulary of the MERL-T knowledge graph.

Every writer takes its label, relation, property, provenance and fonte names
from here; every reader builds its Cypher and its Qdrant filters from here.
`tests/unit/test_graph_vocabulary_contract.py` fails when a Cypher string
under `merlt/` names a relation, a label, a fonte or a provenance this module
does not define. Design: docs/superpowers/specs/2026-09-30-merlt-graph-structure-design.md,
section 4.
"""
from __future__ import annotations

import hashlib
import uuid
from enum import Enum
from typing import Any, Iterable, Mapping, Optional

import structlog

from merlt.utils.map import NORMATTIVA_URN_CODICI
from merlt.utils.urn_labels import article_number_from_urn

log = structlog.get_logger()


class Label(str, Enum):
    """Node labels: the seed's, plus the ones later writers add."""

    NORMA = "Norma"  # an article, an act or a partition (tipo_documento says which)
    COMMA = "Comma"
    LETTERA = "Lettera"
    NUMERO = "Numero"  # multivigenza writes the numbers a modification targets
    DOTTRINA = "Dottrina"
    ATTO_GIUDIZIARIO = "AttoGiudiziario"  # a massima
    LOCUZIONE_LATINA = "LocuzioneLatina"
    CONCETTO_GIURIDICO = "ConcettoGiuridico"
    PRINCIPIO_GIURIDICO = "PrincipioGiuridico"
    DEFINIZIONE_LEGALE = "DefinizioneLegale"
    SOGGETTO_GIURIDICO = "SoggettoGiuridico"
    MODALITA_GIURIDICA = "ModalitaGiuridica"
    EFFETTO_GIURIDICO = "EffettoGiuridico"
    FATTO_GIURIDICO = "FattoGiuridico"
    ATTO_GIURIDICO_ENTITA = "AttoGiuridicoEntita"
    CASO = "Caso"
    ECCEZIONE = "Eccezione"
    PROCEDURA = "Procedura"
    RIMEDIO = "Rimedio"
    RUOLO = "Ruolo"
    CLAUSOLA = "Clausola"
    TERMINE = "Termine"
    SANZIONE = "Sanzione"
    RESPONSABILITA = "Responsabilita"
    ENTITY = "Entity"  # a community entity, written as :Entity:<Tipo>
    LIVE_SOURCE = "LiveSource"  # a source the co-evolution retrieved live


class Rel(str, Enum):
    """Relation types, all upper case: the graph's own plus every community
    RelationType the graph can receive (CITA arrives as RINVIA; PARTE_DI, the
    inverse of CONTIENE, is never written)."""

    # Structure
    CONTIENE = "CONTIENE"
    VERSIONE_DI = "VERSIONE_DI"
    HA_VERSIONE = "HA_VERSIONE"
    VERSIONE_PRECEDENTE = "VERSIONE_PRECEDENTE"
    VERSIONE_SUCCESSIVA = "VERSIONE_SUCCESSIVA"
    # Between norms
    RINVIA = "RINVIA"
    MODIFICA = "MODIFICA"
    ABROGA = "ABROGA"
    ABROGA_TOTALMENTE = "ABROGA_TOTALMENTE"
    ABROGA_PARZIALMENTE = "ABROGA_PARZIALMENTE"
    INSERISCE = "INSERISCE"
    SOSTITUISCE = "SOSTITUISCE"
    INTEGRA = "INTEGRA"
    DEROGA_A = "DEROGA_A"
    SOSPENDE = "SOSPENDE"
    PROROGA = "PROROGA"
    CONSOLIDA = "CONSOLIDA"
    ATTUA = "ATTUA"
    RECEPISCE = "RECEPISCE"
    CONFORME_A = "CONFORME_A"
    DIPENDE_DA = "DIPENDE_DA"
    PRESUPPONE = "PRESUPPONE"
    SPECIES = "SPECIES"
    # Doctrine and case law
    INTERPRETA = "INTERPRETA"  # massima → article
    COMMENTA = "COMMENTA"  # dottrina → article
    ESPRIME = "ESPRIME"  # article → Latin maxim
    MENZIONA = "MENZIONA"  # article → glossary concept
    # Concepts (seed and community)
    DISCIPLINA = "DISCIPLINA"
    APPLICA = "APPLICA"
    APPLICA_A = "APPLICA_A"
    DEFINISCE = "DEFINISCE"
    PREVEDE = "PREVEDE"
    PREVEDE_SANZIONE = "PREVEDE_SANZIONE"
    STABILISCE_TERMINE = "STABILISCE_TERMINE"
    IMPONE = "IMPONE"
    CONFERISCE = "CONFERISCE"
    TITOLARE_DI = "TITOLARE_DI"
    RIVESTE_RUOLO = "RIVESTE_RUOLO"
    ATTRIBUISCE_RESPONSABILITA = "ATTRIBUISCE_RESPONSABILITA"
    RESPONSABILE_PER = "RESPONSABILE_PER"
    ESPRIME_PRINCIPIO = "ESPRIME_PRINCIPIO"
    CONFORMA_A = "CONFORMA_A"
    DEROGA_PRINCIPIO = "DEROGA_PRINCIPIO"
    BILANCIA_CON = "BILANCIA_CON"
    PRODUCE_EFFETTO = "PRODUCE_EFFETTO"
    PRESUPPOSTO_DI = "PRESUPPOSTO_DI"
    COSTITUTIVO_DI = "COSTITUTIVO_DI"
    ESTINGUE = "ESTINGUE"
    MODIFICA_EFFICACIA = "MODIFICA_EFFICACIA"
    APPLICA_REGOLA = "APPLICA_REGOLA"
    IMPLICA = "IMPLICA"
    CONTRADICE = "CONTRADICE"
    GIUSTIFICA = "GIUSTIFICA"
    LIMITA = "LIMITA"
    TUTELA = "TUTELA"
    VIOLA = "VIOLA"
    COMPATIBILE_CON = "COMPATIBILE_CON"
    INCOMPATIBILE_CON = "INCOMPATIBILE_CON"
    SPECIFICA = "SPECIFICA"
    ESEMPLIFICA = "ESEMPLIFICA"
    CAUSA_DI = "CAUSA_DI"
    CONDIZIONE_DI = "CONDIZIONE_DI"
    # Institutions, cases, classification
    EMESSO_DA = "EMESSO_DA"
    HA_COMPETENZA_SU = "HA_COMPETENZA_SU"
    GERARCHICAMENTE_SUPERIORE = "GERARCHICAMENTE_SUPERIORE"
    RIGUARDA = "RIGUARDA"
    APPLICA_NORMA_A_CASO = "APPLICA_NORMA_A_CASO"
    PRECEDENTE_DI = "PRECEDENTE_DI"
    FONTE = "FONTE"
    CLASSIFICA_IN = "CLASSIFICA_IN"
    # Co-evolution
    CORRELATO = "CORRELATO"
    DERIVA_DA = "DERIVA_DA"  # community entity → the live source it came from


_REL_VALUES = frozenset(r.value for r in Rel)

# Names the graph and the code used before this module; the migration renames them.
LEGACY_REL: dict[str, Rel] = {
    "contiene": Rel.CONTIENE,
    "versione_di": Rel.VERSIONE_DI,
    "modifica": Rel.MODIFICA,
    "abroga": Rel.ABROGA,
    "inserisce": Rel.INSERISCE,
    "sostituisce": Rel.SOSTITUISCE,
    "interpreta": Rel.INTERPRETA,
    "commenta": Rel.COMMENTA,
    "CITA": Rel.RINVIA,
    "cita": Rel.RINVIA,
    "rinvia": Rel.RINVIA,
    "richiama": Rel.RINVIA,
}

# Names readers pass that are neither graph nor legacy names: the experts'
# traversal-weight keys and the TraversalPolicy vocabulary (lower-case keys).
REL_ALIASES: dict[str, Rel] = {
    "deroga": Rel.DEROGA_A,
    "connesso_a": Rel.CORRELATO,
    "riferimento": Rel.RINVIA,
    "citato_da": Rel.RINVIA,
    "modificato_da": Rel.MODIFICA,
    "abrogato_da": Rel.ABROGA,
    "derogato_da": Rel.DEROGA_A,
    "interpreted_by": Rel.INTERPRETA,
    "related_to": Rel.CORRELATO,
    "applies_to": Rel.DISCIPLINA,
}


def canonical_rel(name: str) -> Rel:
    """The relation a writer writes, from a canonical or legacy graph name.
    Raises ValueError for anything else: a writer never invents a type."""
    if name in LEGACY_REL:
        return LEGACY_REL[name]
    return Rel(name)


def resolve_rel(name: str) -> str:
    """The graph relation a reader means, whatever case or vocabulary it used.
    An unknown name comes back unchanged: a filter on it matches nothing, as before."""
    if name in LEGACY_REL:
        return LEGACY_REL[name].value
    if name.upper() in _REL_VALUES:
        return name.upper()
    alias = REL_ALIASES.get(name.lower())
    return alias.value if alias else name


def resolve_rels(names: Iterable[str]) -> list[str]:
    """`resolve_rel` over a list, keeping the order and dropping repeats."""
    return list(dict.fromkeys(resolve_rel(n) for n in names))


def community_rel_to_graph(value: str) -> Rel:
    """The graph relation a community-validated RelationType value is written as."""
    if value == "PARTE_DI":
        raise ValueError("PARTE_DI is the inverse of CONTIENE and is never written")
    return canonical_rel(value)


class SourceType(str, Enum):
    """Qdrant `source_type` values."""

    NORMA = "norma"
    COMMA = "comma"
    RATIO = "ratio"
    SPIEGAZIONE = "spiegazione"
    DOTTRINA = "dottrina"
    MASSIMA = "massima"
    CONCETTO = "concetto"
    TEXT = "text"  # a live source of no known kind: no expert searches it


LEGACY_SOURCE_TYPE: dict[str, SourceType] = {
    "concettogiuridico": SourceType.CONCETTO,
    "principiogiuridico": SourceType.CONCETTO,
    "definizionelegale": SourceType.CONCETTO,
}


def canonical_source_type(value: str) -> SourceType:
    if value in LEGACY_SOURCE_TYPE:
        return LEGACY_SOURCE_TYPE[value]
    return SourceType(value)


# Which chunks each expert searches (its canon of art. 12 preleggi).
EXPERT_SOURCE_TYPES: dict[str, list[str]] = {
    "literal": [SourceType.NORMA.value, SourceType.COMMA.value],
    "systemic": [SourceType.NORMA.value, SourceType.COMMA.value],
    "principles": [
        SourceType.RATIO.value, SourceType.SPIEGAZIONE.value,
        SourceType.DOTTRINA.value, SourceType.CONCETTO.value,
    ],
    "precedent": [SourceType.MASSIMA.value],
}


class Provenance(str, Enum):
    SEED = "seed"
    INGESTION = "ingestion"
    COMMUNITY_VALIDATED = "community_validated"
    LIVE_UNCONFIRMED = "live_unconfirmed"
    CONFIRMED = "confirmed"


class Fonte(str, Enum):
    NORMATTIVA = "Normattiva"
    BROCARDI = "Brocardi.it"
    TORRENTE = "manuale:Torrente-libroiv"
    COMMUNITY = "community"
    MCP_LEGAL_IT = "mcp-legal-it"
    ITALIA_CORPUS = "italia_corpus"


_FONTE_ALIASES: dict[str, Fonte] = {
    "normattiva": Fonte.NORMATTIVA,
    "visualexapi": Fonte.NORMATTIVA,  # the norm text comes from Normattiva through VisuaLex
    "brocardi": Fonte.BROCARDI,
    "brocardi.it": Fonte.BROCARDI,
    "manuale:torrente-libroiv": Fonte.TORRENTE,
    "community": Fonte.COMMUNITY,
    "community_validation": Fonte.COMMUNITY,
    "mcp-legal-it": Fonte.MCP_LEGAL_IT,
    "italia_corpus": Fonte.ITALIA_CORPUS,
}


def normalize_fonte(value: Optional[str]) -> Optional[str]:
    """The canonical fonte. An unknown value passes through: never lost."""
    if value is None:
        return None
    hit = _FONTE_ALIASES.get(value.strip().lower())
    return hit.value if hit else value


def canonical_urn(urn: Optional[str]) -> Optional[str]:
    """The graph key of a norm: the full Normattiva URL with the version marker
    (`!vig=…`, `!orig=…`, `@originale`) cut off. The URL wrapper is never
    stripped: the seed keys every node with it. Mirrors the BFF's
    `graphClient.normalizeGraphUrn`."""
    if not urn:
        return urn
    cut = len(urn)
    for mark in ("!", "@"):
        at = urn.find(mark)
        if at != -1:
            cut = min(cut, at)
    return urn[:cut]


# Abbreviations used in `estremi` ("Art. 1982 c.c."), keyed on the lowercased
# act name as VisuaLex spells it in NORMATTIVA_URN_CODICI (visualex_api/tools/
# map.py; copied, MERL-T must not import visualex_api). An explicit table
# replaced a first-letter initialism that turned "codice del consumo" into
# "c.c." (the Codice civile) and "codice in materia di protezione dei dati
# personali" into "c.i.m.p.d.p.".
CODE_ABBREVIATIONS: dict[str, str] = {
    "codice civile": "c.c.",
    "codice penale": "c.p.",
    "codice di procedura civile": "c.p.c.",
    "codice di procedura penale": "c.p.p.",
    "codice del consumo": "cod. cons.",
    "codice della strada": "C.d.S.",
    "codice in materia di protezione dei dati personali": "cod. privacy",
    "codice della privacy": "cod. privacy",
    "codice del processo amministrativo": "c.p.a.",
    "codice della navigazione": "cod. nav.",
    "codice dei contratti pubblici": "cod. contr. pubbl.",
    "codice dell'amministrazione digitale": "CAD",
    "codice della proprieta' industriale": "c.p.i.",
    "codice della proprietà industriale": "c.p.i.",
    "codice delle assicurazioni private": "cod. ass.",
    "codice del turismo": "cod. tur.",
    "codice dell'ambiente": "cod. amb.",
    "codice dei beni culturali e del paesaggio": "cod. beni cult.",
    "codice antimafia": "cod. antimafia",
    "codice della crisi d'impresa e dell'insolvenza": "CCII",
    "codice del terzo settore": "CTS",
    "codice delle comunicazioni elettroniche": "cod. com. el.",
    "codice del processo tributario": "c.p.t.",
    "codice di giustizia contabile": "c.g.c.",
    "codice della nautica da diporto": "cod. naut.",
    "codice dell'ordinamento militare": "c.o.m.",
    "codice delle pari opportunita'": "cod. pari opp.",
    "codice delle pari opportunità": "cod. pari opp.",
    "costituzione": "Cost.",
}


def act_abbreviation(act_type: str) -> str:
    """`"codice civile"` → `"c.c."`. Case- and space-insensitive. An act the
    table does not know keeps its own name, never an invented initialism."""
    key = " ".join(act_type.strip().lower().split())
    if not key:
        return act_type.strip()
    hit = CODE_ABBREVIATIONS.get(key)
    if hit is None:
        log.info("graph_schema.abbrev_fallback", act_type=act_type)
        return act_type.strip()
    return hit


def format_estremi(numero_articolo: str, act_type: str) -> str:
    abbreviation = act_abbreviation(act_type)
    return f"Art. {numero_articolo} {abbreviation}" if abbreviation else f"Art. {numero_articolo}"


_ACT_BY_URN: dict[str, str] = {urn.lower(): name for name, urn in NORMATTIVA_URN_CODICI.items()}


def act_name_from_urn(urn: Optional[str]) -> Optional[str]:
    """The code an article URN belongs to ("codice civile"), from the URN
    table; None for any act the table does not list."""
    if not urn:
        return None
    body = (canonical_urn(urn) or "").split("urn:nir:stato:", 1)[-1]
    return _ACT_BY_URN.get(body.split("~", 1)[0].lower())


def estremi_from_urn(urn: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """`(numero_articolo, estremi)` from a URN: `Art. N <abbreviation>` for a
    code the table knows, `Art. N` otherwise, `(None, None)` without an article."""
    numero = article_number_from_urn(urn)
    if numero is None:
        return None, None
    act = act_name_from_urn(urn)
    return numero, (format_estremi(numero, act) if act else f"Art. {numero}")


def stub_properties(urn: str, provenance: Provenance = Provenance.INGESTION) -> dict[str, Any]:
    """The one shape of a placeholder Norma: its key, its identity, the stub flag."""
    key = canonical_urn(urn)
    numero, estremi = estremi_from_urn(key)
    props: dict[str, Any] = {"URN": key, "node_id": key}
    if numero is not None:
        props["numero_articolo"] = numero
        props["estremi"] = estremi
    props["is_stub"] = True
    props["provenance"] = provenance.value
    return props


# What an article must have in the graph to be complete in phase 1 (spec
# 4.3; the doctrine layer and the vectors join in phase 2).
ARTICLE_COMPLETENESS_PARTS: tuple[str, ...] = ("text", "commi", "hierarchy", "fingerprint")


def text_fingerprint(text: str) -> str:
    """SHA-256 of the exact text (article_text is a data contract)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


_POINT_NAMESPACE = uuid.UUID("0f1d6c9e-6a52-5d0e-9f3b-2a7c4e8b1d35")  # never change: it keys every point


def point_id(article_urn: str, source_type: str, key: str | int = 0) -> str:
    """A Qdrant point id that is the same in every process and every run."""
    return str(uuid.uuid5(_POINT_NAMESPACE, f"{canonical_urn(article_urn)}|{source_type}|{key}"))


TEXT_PROPERTIES: tuple[str, ...] = ("testo", "testo_vigente", "text", "massima", "descrizione")


def node_text(props: Mapping[str, Any]) -> str:
    """The text of a node, whichever writer stored it."""
    for key in TEXT_PROPERTIES:
        value = props.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


# A community entity type → the seed label and node_id prefix of its twin:
# `concetto:crediti_futuri` is the seed's key and the community's id alike.
SEED_TWIN: dict[str, tuple[Label, str]] = {
    "concetto": (Label.CONCETTO_GIURIDICO, "concetto"),
    "principio": (Label.PRINCIPIO_GIURIDICO, "principio"),
    "definizione": (Label.DEFINIZIONE_LEGALE, "definizione"),
    "definizione_legale": (Label.DEFINIZIONE_LEGALE, "definizione"),
    "soggetto_giuridico": (Label.SOGGETTO_GIURIDICO, "soggetto"),
}
```

In `pipeline/mechanical_ingestion/parser.py`, delete the comment block, `_CODE_ABBREVIATIONS` and `_code_abbreviation` (lines 125-179) and add to the imports at the top:

```python
# The abbreviation table lives in the graph's schema; these names stay for the
# parser's callers and tests.
from merlt.storage.graph.schema import CODE_ABBREVIATIONS as _CODE_ABBREVIATIONS  # noqa: F401
from merlt.storage.graph.schema import act_abbreviation as _code_abbreviation
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `… -m pytest tests/unit/test_graph_schema.py tests/unit/test_data_quality_fixes.py tests/pipeline -q -p no:cacheprovider`
Expected: PASS (the parser's own tests import the old names and still pass).

- [ ] **Step 5: Commit**

```bash
git add services/merlt/merlt/storage/graph/schema.py services/merlt/tests/unit/test_graph_schema.py services/merlt/merlt/pipeline/mechanical_ingestion/parser.py
git commit -m "feat(merlt): one schema module for the graph's vocabulary"
```

---

### Task 1b: Indexes and version keys in the schema

Spec 4.1 (amended 1 October). FalkorDB has no index today, so every `MERGE` scans its label; and multivigenza keys a past version `<URN>!vig=<date>`, a key `canonical_urn` folds onto the live article. The schema owns both. The version key also fixes a live bug: the writer keys a version `…!vig=!vig=<date>` and its `VERSIONE_DI` matches no article. It keeps today's model (spec 11, question 5 stays open); Task 6 re-keys and links the versions already written. Pull request B starts here.

**Files:**
- Modify: `services/merlt/merlt/storage/graph/schema.py` (append)
- Modify: `services/merlt/merlt/pipeline/multivigenza.py:~1233` (`_save_version`)
- Test: `services/merlt/tests/unit/test_graph_schema.py` (append), `services/merlt/tests/pipeline/test_multivigenza_version_key.py` (new)

**Interfaces:**
- Consumes: `Label`, `canonical_urn` (Task 1).
- Produces: `GRAPH_INDEXES: tuple[tuple[Label, str], ...]`; `QDRANT_PAYLOAD_INDEXES: dict[str, str]`; `version_urn(urn: str, version_date: str) -> str`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/test_graph_schema.py`:

```python
def test_graph_indexes_cover_every_merge_key():
    keys = set(s.GRAPH_INDEXES)
    for label in (s.Label.NORMA, s.Label.COMMA, s.Label.LETTERA, s.Label.NUMERO):
        assert (label, "URN") in keys
    for label in s.Label:
        assert (label, "node_id") in keys  # a community entity carries node_id too (Task 6)
    assert (s.Label.ENTITY, "id") in keys  # the entity writer still looks it up by id
    assert len(keys) == len(s.GRAPH_INDEXES)  # no index listed twice


def test_qdrant_payload_indexes():
    assert s.QDRANT_PAYLOAD_INDEXES == {"article_urn": "keyword", "source_type": "keyword"}


def test_a_version_has_its_own_key_and_reads_back_to_the_article():
    key = s.version_urn(CC + "@originale", "2020-01-01")
    assert key == CC + "!vig=2020-01-01"
    assert s.canonical_urn(key) == CC  # a reader asking for the version lands on the article
```

```python
# services/merlt/tests/pipeline/test_multivigenza_version_key.py
"""A past version is written under its own key, never the live article's."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from merlt.pipeline.multivigenza import MultivigenzaPipeline

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"


async def test_a_version_is_merged_under_version_urn_and_linked_to_the_article():
    client = AsyncMock()
    client.query.return_value = []
    pipeline = MultivigenzaPipeline(falkordb_client=client, scraper=MagicMock())
    pipeline._timestamp = "2026-10-01T00:00:00+00:00"
    # urngenerator appends "!vig=" to a vigente URN: today the key becomes "…!vig=!vig=2020-01-01"
    # and VERSIONE_DI looks for an article keyed "…!vig=", which does not exist.
    await pipeline._save_version(SimpleNamespace(urn=CC + "!vig="), version_label="v1", version_date="2020-01-01", testo="t")
    merge_params, link_params = (call.args[1] for call in client.query.await_args_list[:2])
    assert merge_params["urn"] == CC + "!vig=2020-01-01"
    assert link_params == {"ver_urn": CC + "!vig=2020-01-01", "art_urn": CC}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `… -m pytest tests/unit/test_graph_schema.py tests/pipeline/test_multivigenza_version_key.py -q -p no:cacheprovider`
Expected: FAIL — `module 'merlt.storage.graph.schema' has no attribute 'GRAPH_INDEXES'`; the multivigenza test gets `…!vig=!vig=2020-01-01`.

- [ ] **Step 3: Implement**

Append to `schema.py`:

```python
# The keys every MERGE looks a node up by (spec 4.1). FalkorDB has no index
# until the migration creates these (Task 6b); without them each MERGE scans
# its whole label, which phase 2's volume cannot afford. A community entity
# carries `node_id` (the same value as its `id`, Task 6) and is still looked
# up by `id` by the entity writer: both are indexed.
GRAPH_INDEXES: tuple[tuple[Label, str], ...] = (
    *((label, "URN") for label in (Label.NORMA, Label.COMMA, Label.LETTERA, Label.NUMERO)),
    *((label, "node_id") for label in Label),
    (Label.ENTITY, "id"),
)

# Qdrant payload fields every reader filters on.
QDRANT_PAYLOAD_INDEXES: dict[str, str] = {"article_urn": "keyword", "source_type": "keyword"}


def version_urn(urn: str, version_date: str) -> str:
    """The key of a past version of an article (multivigenza). A writer uses it
    as it is: `canonical_urn` folds it onto the live article, which is what a
    reader wants and a writer must not do. How versions are modelled for good
    is open (spec section 11)."""
    return f"{canonical_urn(urn)}!vig={version_date}"
```

In `pipeline/multivigenza.py`, import `canonical_urn` and `version_urn` from `merlt.storage.graph.schema`; in `_save_version` replace `versioned_urn = f"{base_urn}!vig={version_date}"` with `versioned_urn = version_urn(base_urn, version_date)`, and the link query's `"art_urn": base_urn` with `"art_urn": canonical_urn(base_urn)`.

In `schema.py`, the comment on `Label.ATTO_GIUDIZIARIO` says only "a massima". Make it say what is true now and what changes: today the seed's node is a massima, keyed `massima_<corte>_<numero>`; phase 2 makes the node the ruling (the pronuncia), keyed by the shared decision identity, with its massime as attributes (the owner decided, 1 October; spec §5.1). A comment only: phase 1 changes no key.

- [ ] **Step 4: Run the tests to verify they pass**

Run the command of Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/merlt/merlt/storage/graph/schema.py services/merlt/merlt/pipeline/multivigenza.py services/merlt/tests/unit/test_graph_schema.py services/merlt/tests/pipeline/test_multivigenza_version_key.py
git commit -m "feat(merlt): the schema lists the graph's indexes and keys a past version"
```

---

### Task 2: The vocabulary contract test (a ratchet)

**Files:**
- Create: `services/merlt/tests/unit/test_graph_vocabulary_contract.py`

**Interfaces:**
- Consumes: `Rel`, `Label`, `Fonte`, `Provenance` (Task 1).
- Produces: `KNOWN_LEGACY_RELS`, `KNOWN_UNKNOWN_LABELS`, `KNOWN_LEGACY_FONTI`, `EXEMPT` in the test module. Tasks 3–5 remove names; Task 5 ends with the three sets empty.

- [ ] **Step 1: Write the test, with today's offenders listed**

The lists below are what a scan of `develop` found on 30 September; each name carries the task that removes it.

```python
# services/merlt/tests/unit/test_graph_vocabulary_contract.py
"""No Cypher string under merlt/ may name a relation, a label, a fonte or a
provenance that merlt/storage/graph/schema.py does not define.

It reads string literals (AST, docstrings skipped, an f-string's pieces joined
with `{}` for its placeholders), so Python slice syntax never matches. Names
built at runtime are invisible here: the writers and readers that build them
test their values against the schema themselves.

The KNOWN_* sets are a ratchet: they list what is still old, and a name must
leave them as soon as the code stops using it.
"""
import ast
import re
from pathlib import Path

from merlt.storage.graph.schema import Fonte, Label, Provenance, Rel

ROOT = Path(__file__).resolve().parents[2] / "merlt"
EXEMPT = {
    # The disagreement companion's offline collector reads relations between
    # decisions that no writer produces; it is not wired to the live graph.
    ROOT / "disagreement" / "data" / "collector.py",
}
REL_RE = re.compile(r"-\[\w*:([A-Za-z_]+(?:\|[A-Za-z_]+)*)")
LABEL_RE = re.compile(r"\(\w*:([A-Z][A-Za-z]+)")
FONTE_RE = re.compile(r"\bfonte\s*[=:]\s*'([^']+)'")
PROVENANCE_RE = re.compile(r"\bprovenance\s*[=:]\s*'([^']+)'")
CYPHER_RE = re.compile(r"\b(MATCH|MERGE)\b")

KNOWN_LEGACY_RELS: set[str] = {
    "commenta", "interpreta", "versione_di",  # Task 3
    "CITA",  # Task 4
    "contiene", "abroga", "modifica", "sostituisce", "inserisce", "CONTENUTO_IN",  # Task 5
    "cita", "conferma", "supera", "DERIVA",  # Task 5 (unwired tools)
}
KNOWN_UNKNOWN_LABELS: set[str] = {"PendingValidation", "ValidationVote"}  # Task 5
KNOWN_LEGACY_FONTI: set[str] = {"Brocardi", "VisualexAPI", "community_validation"}  # Tasks 3 and 4


def _units(tree: ast.AST) -> list[tuple[int, str]]:
    docstrings, inside = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                docstrings.add(id(first.value))
    units = []
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            parts = []
            for value in node.values:
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    parts.append(value.value)
                    inside.add(id(value))
                else:
                    parts.append("{}")
            units.append((node.lineno, "".join(parts)))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in inside | docstrings:
            units.append((node.lineno, node.value))
    return units


def _found() -> dict[str, dict[str, list[str]]]:
    found: dict[str, dict[str, list[str]]] = {"rel": {}, "label": {}, "fonte": {}, "provenance": {}}
    for path in sorted(ROOT.rglob("*.py")):
        if path in EXEMPT:
            continue
        for line, text in _units(ast.parse(path.read_text(encoding="utf-8"))):
            where = f"{path.relative_to(ROOT)}:{line}"
            for match in REL_RE.finditer(text):
                for name in match.group(1).split("|"):
                    found["rel"].setdefault(name, []).append(where)
            for match in LABEL_RE.finditer(text):
                found["label"].setdefault(match.group(1), []).append(where)
            if CYPHER_RE.search(text):
                for match in FONTE_RE.finditer(text):
                    found["fonte"].setdefault(match.group(1), []).append(where)
                for match in PROVENANCE_RE.finditer(text):
                    found["provenance"].setdefault(match.group(1), []).append(where)
    return found


def _check(kind: str, allowed: set[str], known: set[str]) -> None:
    names = _found()[kind]
    offenders = {name: where for name, where in names.items() if name not in allowed}
    new = {name: where for name, where in offenders.items() if name not in known}
    assert not new, f"{kind} outside the schema: {new}"
    gone = known - offenders.keys()
    assert not gone, f"no longer used, remove from the known {kind} set: {sorted(gone)}"


def test_every_relation_in_cypher_is_canonical():
    _check("rel", {r.value for r in Rel}, KNOWN_LEGACY_RELS)


def test_every_label_in_cypher_is_known():
    _check("label", {label.value for label in Label}, KNOWN_UNKNOWN_LABELS)


def test_every_fonte_in_cypher_is_canonical():
    _check("fonte", {f.value for f in Fonte}, KNOWN_LEGACY_FONTI)


def test_every_provenance_in_cypher_is_canonical():
    _check("provenance", {p.value for p in Provenance}, set())
```

- [ ] **Step 2: Run it**

Run: `… -m pytest tests/unit/test_graph_vocabulary_contract.py -q -p no:cacheprovider`
Expected: PASS. If a name is reported that the lists above do not have (code merged since 30 September), add it to its set with the task that removes it; if a label is reported that a live writer really writes, add it to `Label` in `schema.py` instead, with a comment naming the writer.

- [ ] **Step 3: Commit**

```bash
git add services/merlt/tests/unit/test_graph_vocabulary_contract.py
git commit -m "test(merlt): a contract test that ratchets the graph vocabulary"
```

---

### Task 3: The ingestion writers use the schema

**Files:**
- Modify: `services/merlt/merlt/pipeline/ingestion.py` (`_canonical_urn` :39-53; the brocardi normalisation :218-221; codice and partition `fonte` :461-641; every `contiene` :542-864 and the docstring at :784; the article MERGE :698-745; `commenta` :907-1080; `interpreta` :1210)
- Modify: `services/merlt/merlt/pipeline/visualex.py:82-96` (`to_estremi`)
- Modify: `services/merlt/merlt/pipeline/multivigenza.py:51-57` (`RELATION_TYPES`) and :1243 (`versione_di`)
- Modify: `services/merlt/merlt/core/legal_knowledge_graph.py:612-700` (Qdrant ids and payload)
- Modify: `services/merlt/merlt/scripts/load_seed_libro_iv.py` (`_merge_nodes` :245, `_merge_edges` :263, the point ids :362, `_infer_source_type` :382)
- Modify: `services/merlt/merlt/pipeline/mechanical_ingestion/parser.py` (visualex_tree props :421-440; italia_corpus props :602 and :633-652)
- Test: `services/merlt/tests/pipeline/test_ingestion_vocabulary.py` (new)
- Modify: `services/merlt/tests/unit/test_graph_vocabulary_contract.py` (ratchet)

**Interfaces:**
- Consumes: `canonical_urn`, `canonical_rel`, `canonical_source_type`, `format_estremi`, `normalize_fonte`, `point_id`, `text_fingerprint`, `Fonte`, `Provenance`, `Rel`, `SourceType` (Task 1).
- Produces: `pipeline.ingestion._canonical_urn` keeps its name and returns `canonical_urn(urn)`; the seed loader's `_merge_nodes`/`_merge_edges` (reused by the mechanical promotion) write canonical names, `fonte`, `provenance`, `testo`, `testo_sha256`; `multivigenza.RELATION_TYPES` values are `Rel` values; every `Norma` article written by ingestion carries `testo`, `testo_sha256`, `fonte`, `provenance`; `parser._article_props_extra(text) -> dict`.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/pipeline/test_ingestion_vocabulary.py
"""The ingestion writers speak the schema's vocabulary (spec 2026-09-30, §4)."""
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from merlt.pipeline.ingestion import IngestionPipelineV2, _canonical_urn
from merlt.pipeline.multivigenza import RELATION_TYPES
from merlt.pipeline.visualex import NormaMetadata, VisualexArticle
from merlt.scripts import load_seed_libro_iv as seed
from merlt.storage.graph.schema import Rel, canonical_rel, point_id, text_fingerprint

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"


def _meta(tipo_atto="codice civile", numero="2043"):
    return NormaMetadata(tipo_atto=tipo_atto, data="1942-03-16", numero_atto="262", numero_articolo=numero)


def test_ingestion_cuts_originale_too():
    assert _canonical_urn(CC + "@originale") == CC


def test_estremi_come_from_the_schema():
    assert _meta().to_estremi() == "Art. 2043 c.c."
    assert NormaMetadata(tipo_atto="Costituzione", data="", numero_atto="", numero_articolo="1").to_estremi() == "Art. 1 Cost."


def test_multivigenza_writes_canonical_relations():
    assert {Rel(value) for value in RELATION_TYPES.values()} == {Rel.ABROGA, Rel.SOSTITUISCE, Rel.MODIFICA, Rel.INSERISCE}


async def test_an_article_without_doctrine_is_ingested():
    client = MagicMock()
    client.query = AsyncMock(return_value=[])
    article = VisualexArticle(
        metadata=_meta(numero="1321"),
        article_text="Testo dell'articolo.",
        url=CC.replace("2043", "1321"),
        brocardi_info=None,
    )
    # Raised TypeError ("NormaMetadata is not iterable") before this task: every
    # article without doctrine failed and the job still reported completed.
    await IngestionPipelineV2(falkordb_client=client).ingest_article(article)
    writes = [c for c in client.query.await_args_list if "MERGE (art:Norma {URN: $urn})" in c.args[0]]
    cypher, params = writes[0].args
    assert "art.testo = $testo" in cypher and "art.testo_sha256 = $testo_sha256" in cypher
    assert params["testo_sha256"] == text_fingerprint("Testo dell'articolo.")
    assert params["fonte"] == "Normattiva" and params["provenance"] == "ingestion"
    written = "\n".join(c.args[0] for c in client.query.await_args_list)
    assert ":contiene" not in written and "CONTIENE" in written


async def test_lazy_vectors_have_ids_stable_across_processes():
    from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph

    kg = LegalKnowledgeGraph.__new__(LegalKnowledgeGraph)
    kg._qdrant = MagicMock()
    kg._embedding_service = MagicMock(encode_document_async=AsyncMock(return_value=[0.1, 0.2]))
    kg.config = MagicMock(qdrant_collection="chunks")
    await kg._upsert_embeddings_multi_source(
        article_text="Testo dell'articolo abbastanza lungo.",
        article_urn=CC + "!vig=",
        metadata=_meta(),
        brocardi_info={"Massime": ["x" * 60, "y" * 60]},
    )
    points = kg._qdrant.upsert.call_args.kwargs["points"]
    assert [p.id for p in points] == [point_id(CC, "norma"), point_id(CC, "massima", 0), point_id(CC, "massima", 1)]
    assert {p.payload["article_urn"] for p in points} == {CC}
    assert [p.payload["fonte"] for p in points] == ["Normattiva", "Brocardi.it", "Brocardi.it"]


class _Recorder:
    def __init__(self):
        self.calls = []

    async def query(self, cypher, params=None):
        self.calls.append((cypher, params or {}))
        return []


async def test_seed_edges_are_written_with_canonical_names():
    client = _Recorder()
    id_to_key = {1: {"key": "a", "label": "Norma", "key_field": "URN"}, 2: {"key": "b", "label": "Norma", "key_field": "URN"}}
    edges = [{"start": 1, "end": 2, "type": "interpreta", "properties": {}},
             {"start": 1, "end": 2, "type": "contiene", "properties": {}}]
    merged, skipped = await seed._merge_edges(client, edges, id_to_key)
    written = "\n".join(cypher for cypher, _ in client.calls)
    assert (merged, skipped) == (2, 0)
    assert "[r:INTERPRETA " in written and "[r:CONTIENE " in written


async def test_seed_nodes_carry_text_fingerprint_fonte_and_provenance():
    client = _Recorder()
    nodes = [{"id": 1, "labels": ["Norma"], "properties": {"URN": "a", "testo_vigente": "T", "fonte": "VisualexAPI"}}]
    await seed._merge_nodes(client, nodes, {1: {"key": "a", "label": "Norma", "key_field": "URN"}})
    props = client.calls[0][1]["props"]
    assert props["testo"] == "T" and props["testo_sha256"] == text_fingerprint("T")
    assert props["fonte"] == "Normattiva" and props["provenance"] == "seed"


def test_seed_source_types_are_canonical():
    assert seed._infer_source_type("ConcettoGiuridico") == "concetto"
    assert seed._infer_source_type("AttoGiudiziario") == "massima"
    assert seed._infer_source_type("Comma") == "comma"


def test_every_seed_relation_has_a_canonical_name():
    if not seed.SEED_GRAPH_JSON.exists():  # the seed is data, not in git: CI has no copy
        pytest.skip("seed file not present")
    meta = json.loads(seed.SEED_GRAPH_JSON.read_text(encoding="utf-8"))["meta"]
    for rel_type in meta["counts"]["rel_types"]:
        canonical_rel(rel_type)


def test_mechanical_articles_carry_testo_and_fingerprint():
    from merlt.pipeline.mechanical_ingestion import parser

    assert parser._article_props_extra("Testo.") == {
        "testo": "Testo.", "testo_sha256": text_fingerprint("Testo."), "provenance": "ingestion",
    }
```

(`test_an_article_without_doctrine_is_ingested` drives the pipeline with a fake client; if a later step of `ingest_article` needs a richer fake, give `client.query` a `side_effect` that returns `[]` for writes — never weaken the assertions.)

- [ ] **Step 2: Run them to verify they fail**

Run: `… -m pytest tests/pipeline/test_ingestion_vocabulary.py -q -p no:cacheprovider`
Expected: FAIL (`@originale` kept, `Art. 1 Costituzione`, lowercase map values, TypeError, `hash()` ids, lowercase seed edges, `concettogiuridico`, no `_article_props_extra`).

- [ ] **Step 3: Implement**

`pipeline/ingestion.py`:

```python
from merlt.storage.graph.schema import Fonte, Provenance, canonical_urn, text_fingerprint


def _canonical_urn(urn: str) -> str:
    """The graph key of a norm (`schema.canonical_urn`); kept for its importers."""
    return canonical_urn(urn)
```

The normalisation at the top of `ingest_article`:

```python
        # A legacy caller may hand the doctrine inside a dict `metadata`; the
        # common NormaMetadata dataclass has no such field (`in` on it raised
        # TypeError and aborted every article without doctrine).
        if not article.brocardi_info and isinstance(article.metadata, dict) and article.metadata.get("brocardi_info"):
            article.brocardi_info = article.metadata["brocardi_info"]
            log.info("Injected brocardi_info from metadata")
```

In the article MERGE (both the `ON CREATE SET` and the `ON MATCH SET` branch): replace `art.fonte = 'VisualexAPI',` with `art.fonte = $fonte,`; after `art.testo_vigente = $testo,` add `art.testo = $testo,` and `art.testo_sha256 = $testo_sha256,`; add `art.provenance = $provenance,` to `ON CREATE SET` and `art.provenance = coalesce(art.provenance, $provenance),` to `ON MATCH SET`. Add to the params:

```python
                "fonte": Fonte.NORMATTIVA.value,
                "provenance": Provenance.INGESTION.value,
                "testo_sha256": text_fingerprint(article.article_text) if article.article_text else None,
```

The remaining literals: `codice.fonte = 'VisualexAPI'` (:461) → `codice.fonte = 'Normattiva'`; `libro/titolo/capo/sezione.fonte = 'Brocardi'` (:523, :556, :589, :622) → `'Brocardi.it'`; every `[r:contiene]` and `[:contiene]` → `CONTIENE` (the docstring at :784 too); every `[r:commenta]` → `COMMENTA`; `[r:interpreta]` → `INTERPRETA`; the `relations_created` log strings `f"contiene:…"` → `f"CONTIENE:…"`.

`pipeline/visualex.py`:

```python
    def to_estremi(self) -> str:
        """`Art. 1453 c.c.`, `Art. 1 Cost.`: the schema's one formatter."""
        from merlt.storage.graph.schema import format_estremi

        return format_estremi(str(self.numero_articolo), self.tipo_atto)
```

`pipeline/multivigenza.py`:

```python
from merlt.storage.graph.schema import Rel

# Graph relation types for modifications
RELATION_TYPES = {
    TipoModifica.ABROGA: Rel.ABROGA.value,
    TipoModifica.SOSTITUISCE: Rel.SOSTITUISCE.value,
    TipoModifica.MODIFICA: Rel.MODIFICA.value,
    TipoModifica.INSERISCE: Rel.INSERISCE.value,
}
```

and `MERGE (ver)-[r:versione_di]->(art)` → `MERGE (ver)-[r:VERSIONE_DI]->(art)`.

`core/legal_knowledge_graph.py`, in `_upsert_embeddings_multi_source`:

```python
from merlt.storage.graph.schema import Fonte, SourceType, canonical_urn, point_id

        article_urn = canonical_urn(article_urn)
        base_payload = {
            "article_urn": article_urn,
            "tipo_atto": metadata.tipo_atto,
            "numero_articolo": metadata.numero_articolo,
        }
```

Each `point_id = hash(f"{article_urn}:<kind>") % (2**63)` becomes `pid = point_id(article_urn, SourceType.<KIND>.value)` — `NORMA`, `SPIEGAZIONE`, `RATIO` — and the massima's `pid = point_id(article_urn, SourceType.MASSIMA.value, i)`; `PointStruct(id=pid, …)`. Add `"fonte": Fonte.NORMATTIVA.value` to the norm's payload and `"fonte": Fonte.BROCARDI.value` to spiegazione, ratio and massime.

`scripts/load_seed_libro_iv.py`:

```python
from merlt.storage.graph.schema import (
    Provenance, Rel, canonical_rel, canonical_source_type, normalize_fonte, point_id, text_fingerprint,
)


async def _merge_nodes(client, nodes: list[dict], id_to_key: dict[int, dict]) -> int:
    """MERGE every node by its (label, key_field, key), in the schema's vocabulary. Idempotent."""
    merged = 0
    for n in nodes:
        entry = id_to_key.get(n["id"])
        if not entry:
            continue
        props = dict(n.get("properties") or {})
        if props.get("fonte"):
            props["fonte"] = normalize_fonte(props["fonte"])
        if entry["label"] == "Norma" and props.get("testo_vigente") and not props.get("testo"):
            props["testo"] = props["testo_vigente"]
        if entry["label"] == "Norma" and props.get("testo"):
            props["testo_sha256"] = text_fingerprint(props["testo"])
        props.setdefault("provenance", Provenance.SEED.value)  # a mechanical batch brings its own
        cypher = (
            f"MERGE (x:{entry['label']} {{{entry['key_field']}: $k}}) "
            f"SET x += $props"
        )
        await client.query(cypher, {"k": entry["key"], "props": props})
        merged += 1
        if merged % NODE_BATCH == 0:
            log.info("seed_loader.nodes_progress", merged=merged, total=len(nodes))
    return merged
```

In `_merge_edges`, move `etype`, `key_material`, `edge_key` and `cypher` inside the per-edge `try`, so an unknown type is skipped and logged like any failed edge, with

```python
            etype = canonical_rel(e["type"]).value if e.get("type") else Rel.CORRELATO.value
```

In `_generate_and_upsert_embeddings`, `chunk_uuid = str(uuid.uuid4())` becomes `chunk_uuid = point_id(meta["article_urn"], meta["source_type"], text_fingerprint(text)[:16])` (the bridge realignment keeps working: it maps by text). `_infer_source_type`:

```python
def _infer_source_type(label: str) -> str:
    if label == "AttoGiudiziario":
        return "massima"
    if label == "Dottrina":
        return "dottrina"
    if label == "Norma":
        return "norma"
    if label == "Comma":
        return "comma"
    if label in ("ConcettoGiuridico", "PrincipioGiuridico", "DefinizioneLegale"):
        return canonical_source_type(label.lower()).value
    return "text"
```

`pipeline/mechanical_ingestion/parser.py`:

```python
from merlt.storage.graph.schema import Fonte, Provenance, text_fingerprint


def _article_props_extra(text: str) -> dict[str, Any]:
    """What every mechanically parsed article adds to its own properties."""
    return {"testo": text, "testo_sha256": text_fingerprint(text), "provenance": Provenance.INGESTION.value}
```

In the visualex_tree adapter, `"fonte": "VisualexAPI"` becomes `"fonte": Fonte.NORMATTIVA.value` and `props.update(_article_props_extra(text))` follows the dict. In the italia_corpus `_flush_article`, after `current_props["testo_vigente"] = …` add `current_props.update(_article_props_extra(current_props["testo_vigente"]))`; its `"fonte": "italia_corpus"` stays (a canonical value). The parser tests that assert `testo_vigente` keep passing.

Ratchet: remove `"commenta"`, `"interpreta"`, `"versione_di"` from `KNOWN_LEGACY_RELS` and `"Brocardi"`, `"VisualexAPI"` from `KNOWN_LEGACY_FONTI`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `… -m pytest tests/pipeline tests/unit tests/scripts -q -p no:cacheprovider`
Expected: PASS, including the contract test with the smaller sets.

- [ ] **Step 5: Commit**

```bash
git add services/merlt/merlt services/merlt/tests
git commit -m "refactor(merlt): the ingestion writers speak the schema's vocabulary"
```

---

### Task 4: The community and co-evolution writers use the schema

**Files:**
- Modify: `services/merlt/merlt/storage/graph/entity_writer.py` (`_check_duplicate_mechanical` :232-266; `_create_entity_relation` :407-478; `_link_provisional_source` :480-535)
- Modify: `services/merlt/merlt/api/enrichment_router.py` (`_relation_write_cypher` :1598-1632; `_write_relation_to_graph` :1635-1720; the provisional listing's `n.text` :2470)
- Modify: `services/merlt/merlt/pipeline/provisional_writer.py:282,292` (`n.text` → `n.testo`)
- Test: `services/merlt/tests/unit/test_writers_vocabulary.py` (new); `services/merlt/tests/api/test_relation_graph_write.py` (the stub assertion at :199)
- Modify: `services/merlt/tests/unit/test_graph_vocabulary_contract.py` (ratchet)

**Interfaces:**
- Consumes: `Rel`, `community_rel_to_graph`, `canonical_urn`, `stub_properties`, `SEED_TWIN`, `Provenance` (Task 1).
- Produces: `entity_writer.RELATION_BY_ENTITY_TYPE: dict[str, Rel]` (module level); community relations reach the graph under canonical names; a community entity whose seed twin exists becomes that node (the seed node gains `:Entity` and the community `id`).

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/unit/test_writers_vocabulary.py
"""The community and co-evolution writers speak the schema's vocabulary."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from merlt.storage.graph import entity_writer
from merlt.storage.graph.entity_writer import RELATION_BY_ENTITY_TYPE
from merlt.storage.graph.schema import Rel

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1322"


def test_every_entity_relation_is_canonical():
    assert RELATION_BY_ENTITY_TYPE and all(isinstance(rel, Rel) for rel in RELATION_BY_ENTITY_TYPE.values())


def test_entity_types_use_the_seed_relations():
    assert RELATION_BY_ENTITY_TYPE["soggetto_giuridico"] is Rel.APPLICA_A
    assert RELATION_BY_ENTITY_TYPE["fatto_giuridico"] is Rel.PREVEDE
    assert RELATION_BY_ENTITY_TYPE["sanzione"] is Rel.PREVEDE_SANZIONE
    assert RELATION_BY_ENTITY_TYPE["procedura"] is Rel.PREVEDE
    assert RELATION_BY_ENTITY_TYPE["responsabilita"] is Rel.ATTRIBUISCE_RESPONSABILITA


def _writer(rows=None):
    client = MagicMock()
    client.query = AsyncMock(return_value=rows if rows is not None else [{"r": 1}])
    writer = entity_writer.EntityGraphWriter.__new__(entity_writer.EntityGraphWriter)
    writer.falkordb = client
    writer._timestamp = "2026-10-01T00:00:00+00:00"
    return writer, client


async def test_the_norm_stub_has_the_one_shape_and_the_existing_node_is_not_touched():
    writer, client = _writer()
    entity = SimpleNamespace(entity_type="sanzione", article_urn=CC + "@originale")
    await writer._create_entity_relation(entity, "sanzione:multa")
    cypher, params = client.query.await_args.args
    assert "ON CREATE SET art += $stub" in cypher
    assert "coalesce(art.provenance" not in cypher and "art.trust" not in cypher
    assert params["stub"] == {
        "URN": CC, "node_id": CC, "numero_articolo": "1322", "estremi": "Art. 1322 c.c.",
        "is_stub": True, "provenance": "ingestion",
    }
    assert params["article_urn"] == CC
    assert "-[r:PREVEDE_SANZIONE]->" in cypher


async def test_a_live_source_link_is_deriva_da():
    writer, client = _writer(rows=[{"id": "x"}])
    await writer._link_provisional_source("pending-1", "concetto:x")
    assert "-[r:DERIVA_DA]->" in client.query.await_args.args[0]


async def test_a_community_concept_becomes_its_seed_twin():
    writer, client = _writer()
    client.query = AsyncMock(side_effect=[[], [{"id": "concetto:crediti_futuri"}]])
    found = await writer._check_duplicate_mechanical("Crediti futuri", "concetto")
    assert found == "concetto:crediti_futuri"
    cypher, params = client.query.await_args_list[1].args
    assert "MATCH (c:ConcettoGiuridico {node_id: $nid})" in cypher and "SET c:Entity" in cypher
    assert params == {"nid": "concetto:crediti_futuri", "eid": "concetto:crediti_futuri"}
```

In `tests/api/test_relation_graph_write.py`, replace `params["source_numero_articolo"] == "3"` with `params["source_stub"]["numero_articolo"] == "3"`, and add a test that writes a relation of type `CITA` (copy the nearest passing test, set `relation_type="CITA"`) and asserts `"-[r:RINVIA]->"` in the written Cypher. `test_invalid_relation_type_is_refused` keeps passing unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `… -m pytest tests/unit/test_writers_vocabulary.py tests/api/test_relation_graph_write.py -q -p no:cacheprovider`
Expected: FAIL (`RELATION_BY_ENTITY_TYPE` missing).

- [ ] **Step 3: Implement**

`storage/graph/entity_writer.py`, module level:

```python
from merlt.storage.graph.schema import Provenance, Rel, SEED_TWIN, canonical_urn, stub_properties

# article → entity relation, by the entity's type: the seed's names.
RELATION_BY_ENTITY_TYPE: dict[str, Rel] = {
    "principio": Rel.ESPRIME_PRINCIPIO,
    "definizione": Rel.DEFINISCE,
    "definizione_legale": Rel.DEFINISCE,
    "concetto": Rel.DISCIPLINA,
    "diritto_soggettivo": Rel.CONFERISCE,
    "interesse_legittimo": Rel.DISCIPLINA,
    "soggetto_giuridico": Rel.APPLICA_A,
    "ruolo_giuridico": Rel.APPLICA_A,
    "organo": Rel.APPLICA_A,
    "fatto_giuridico": Rel.PREVEDE,
    "procedura": Rel.PREVEDE,
    "termine": Rel.STABILISCE_TERMINE,
    "sanzione": Rel.PREVEDE_SANZIONE,
    "responsabilita": Rel.ATTRIBUISCE_RESPONSABILITA,
    "modalita_giuridica": Rel.IMPONE,
    "brocardo": Rel.ESPRIME,
}
```

`_create_entity_relation`: `relation_type = RELATION_BY_ENTITY_TYPE.get(entity.entity_type, Rel.DISCIPLINA).value`, and the query and params become

```python
        query = f"""
        MERGE (art:Norma {{URN: $article_urn}})
        ON CREATE SET art += $stub, art.created_at = $timestamp
        WITH art
        MATCH (e:Entity {{id: $entity_id}})
        MERGE (art)-[r:{relation_type}]->(e)
        ON CREATE SET
            r.certezza = 1.0,
            r.fonte = 'community',
            r.provenance = $provenance,
            r.created_at = $timestamp
        RETURN r
        """

        params = {
            "article_urn": canonical_urn(entity.article_urn),
            "stub": stub_properties(entity.article_urn),
            "entity_id": node_id,
            "provenance": Provenance.COMMUNITY_VALIDATED.value,
            "timestamp": self._timestamp,
        }
```

It no longer stamps `provenance`/`trust` on a Norma it did not create (the audit found it marking every unmarked article `community_validated`); the relation keeps its provenance. Drop the `derive_article_fields_from_urn` import if nothing else in the file uses it, and update the docstring's examples to the new relation names.

`_link_provisional_source`: `MERGE (e)-[r:CITA]->(ls)` → `MERGE (e)-[r:DERIVA_DA]->(ls)`, `r.fonte = 'community_validation'` → `r.fonte = 'community'`; its docstring and the comment in `write_entity` say `DERIVA_DA`.

`_check_duplicate_mechanical`, after the `Entity` lookup finds nothing:

```python
        twin = SEED_TWIN.get(entity_type)
        if twin:
            label, prefix = twin
            # The seed already has this concept: it becomes the community entity
            # (one node, one key) instead of a twin next to it.
            rows = await self.falkordb.query(
                f"MATCH (c:{label.value} {{node_id: $nid}}) SET c:Entity, c.id = $eid RETURN c.id AS id",
                {"nid": f"{prefix}:{normalized}", "eid": expected_id},
            )
            if rows:
                return rows[0]["id"]
        return None
```

`api/enrichment_router.py`, in `_write_relation_to_graph` after the regex guard:

```python
    try:
        rel_type = community_rel_to_graph(rel_type).value
    except ValueError:
        log.error("Relation not written to graph: not a graph relation", relation_id=relation.relation_id, relation_type=rel_type)
        return RelationWriteOutcome(written=False, reason=f"invalid relation type {rel_type!r}")
```

In the params loop, for an endpoint that creates a Norma:

```python
        for var, ep in (("source", source), ("target", target)):
            if ep.create_norma:
                params[f"{var}_key"] = canonical_urn(ep.key)
                params[f"{var}_stub"] = stub_properties(ep.key)
```

and in `_relation_write_cypher` the stub branch becomes `ON CREATE SET {var} += ${var}_stub, {var}.created_at = $timestamp`; `r.fonte = 'community_validation'` → `r.fonte = 'community'`. The provisional listing at :2470 returns `coalesce(n.testo, n.text) AS text`. Import `community_rel_to_graph`, `canonical_urn`, `stub_properties` from the schema.

`pipeline/provisional_writer.py`: both `n.text = $text` → `n.testo = $text` (the migration moves the existing nodes' `text` into `testo`).

Ratchet: remove `"CITA"` from `KNOWN_LEGACY_RELS` and `"community_validation"` from `KNOWN_LEGACY_FONTI` (`KNOWN_LEGACY_FONTI` is now empty).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `… -m pytest tests/unit tests/api -q -p no:cacheprovider` (the DB-backed API tests need `ENRICHMENT_DATABASE_URL` on a disposable Postgres, `services/merlt/CLAUDE.md` "Tests"; without one, run `tests/unit` plus `tests/api/test_relation_graph_write.py` and let CI run the rest).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/merlt/merlt services/merlt/tests
git commit -m "refactor(merlt): community and co-evolution writers speak the schema's vocabulary"
```

---

### Task 5: The readers use the schema

**Files:**
- Modify: `services/merlt/merlt/tools/search.py:612-636` (the graph tool resolves names and the start URN)
- Modify: `services/merlt/merlt/experts/systemic.py:131-137`, `experts/literal.py:~297-310`, `experts/principles.py:~327-357`, `experts/precedent.py:~348-378`, `experts/react_mixin.py:~1078`
- Modify: `services/merlt/merlt/tools/historical_evolution.py:~225-230`, `tools/textual_reference.py:~141,183-196`, `tools/hierarchy.py:~335-442`, `tools/definition.py:~286-294` (and every other `testo_vigente` read in it)
- Modify: `services/merlt/merlt/storage/temporal/validity_service.py:~284,318,383`, `core/legal_knowledge_graph.py:~795` (`_get_graph_context`), `api/graph_router.py:~381` (relations filter)
- Modify: `services/merlt/merlt/api/engine_bootstrap.py:~104-116` (unwire two tools)
- Modify: `services/merlt/merlt/storage/retriever/models.py:192-210`, `storage/retriever/retriever.py:~605-610`
- Modify: `services/merlt/merlt/rlcf/policy_gradient.py:175-192`
- Delete: `services/merlt/merlt/storage/graph/validation.py` (no importer; its labels exist nowhere)
- Test: `services/merlt/tests/unit/test_readers_vocabulary.py` (new); `services/merlt/tests/unit/test_traversal_inference_steering.py` (renamed relations)
- Modify: `services/merlt/tests/unit/test_graph_vocabulary_contract.py` (the remaining sets end empty; two files join `EXEMPT`)

**Interfaces:**
- Consumes: `Rel`, `Label`, `resolve_rel`, `resolve_rels`, `canonical_urn`, `node_text`, `EXPERT_SOURCE_TYPES` (Task 1).
- Produces: `SystemicExpert.STATIC_SYSTEMIC_RELATIONS` / `NEURAL_EXTRA_CANDIDATE_RELATIONS`, `LiteralExpert.GRAPH_RELATIONS`, `PrinciplesExpert.GRAPH_RELATIONS`, `PrecedentExpert.GRAPH_RELATIONS` (canonical names); `precedent._case_law_from_node(node, source_urn) -> dict | None`; `retriever.models.EXPERT_SOURCE_TYPES` derived from the schema.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/unit/test_readers_vocabulary.py
"""The experts, tools, retriever and policy read the schema's vocabulary."""
from unittest.mock import MagicMock

import pytest

from merlt.experts.literal import LiteralExpert
from merlt.experts.precedent import PrecedentExpert, _case_law_from_node
from merlt.experts.principles import PrinciplesExpert
from merlt.experts.systemic import SystemicExpert
from merlt.rlcf.policy_gradient import normalize_relation_type
from merlt.storage.graph.schema import Rel
from merlt.storage.retriever.models import EXPERT_SOURCE_TYPES
from merlt.storage.retriever.retriever import GraphAwareRetriever
from merlt.tools.search import GraphSearchTool

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"


@pytest.mark.parametrize("names", [
    SystemicExpert.STATIC_SYSTEMIC_RELATIONS, SystemicExpert.NEURAL_EXTRA_CANDIDATE_RELATIONS,
    LiteralExpert.GRAPH_RELATIONS, PrinciplesExpert.GRAPH_RELATIONS, PrecedentExpert.GRAPH_RELATIONS,
])
def test_every_expert_asks_for_canonical_relations(names):
    assert names and all(Rel(name) for name in names)


@pytest.mark.parametrize("name", [
    "DISCIPLINA", "INTERPRETA", "IMPONE", "CORRELATO", "DEROGA_A", "RINVIA", "CONTIENE",
    "COMMENTA", "ESPRIME_PRINCIPIO", "PREVEDE", "INSERISCE", "SOSTITUISCE",
])
def test_the_policy_scores_every_canonical_relation(name):
    # A name the policy cannot map comes back unchanged and collapses on RELATED_TO.
    assert normalize_relation_type(name) != name


def test_the_graph_tool_resolves_any_callers_names_and_the_start_urn():
    tool = GraphSearchTool(graph_db=None)
    query, params = tool._build_traversal_query(
        start_node=CC + "@originale", relation_types=["contiene", "cita", "deroga", "RELATED_TO"],
        max_hops=2, target_type=None, direction="both",
    )
    assert "[r:CONTIENE|RINVIA|DEROGA_A|CORRELATO*1..2]" in query
    assert params == {"start_urn": CC}


def test_a_seed_massima_is_read_as_case_law():
    node = {"type": "AttoGiudiziario", "urn": "", "properties": {"massima": "Testo della massima.", "organo_emittente": "Cass. civ."}}
    entry = _case_law_from_node(node, CC)
    assert entry["text"] == "Testo della massima." and entry["court"] == "Cass. civ."
    assert _case_law_from_node({"type": "Norma", "properties": {}}, CC) is None


def test_retriever_filters_come_from_the_schema():
    assert EXPERT_SOURCE_TYPES["literal"] == EXPERT_SOURCE_TYPES["LiteralExpert"] == ["norma", "comma"]
    assert "concetto" in EXPERT_SOURCE_TYPES["PrinciplesExpert"]
    assert EXPERT_SOURCE_TYPES["precedent"] == ["massima"]


def test_traversal_weights_read_upper_case_relations():
    retriever = GraphAwareRetriever(vector_db=MagicMock(), graph_db=MagicMock(), bridge_table=MagicMock())
    assert retriever._compute_static_relation_bonus(["CONTIENE"], "LiteralExpert") == 1.0
```

Hierarchy, in the same file:

```python
class _GraphRecorder:
    def __init__(self):
        self.cyphers = []

    async def query(self, cypher, params=None):
        self.cyphers.append(cypher)
        return []


async def test_the_hierarchy_walks_contiene_backwards():
    from merlt.tools.hierarchy import HierarchyNavigationTool

    graph = _GraphRecorder()
    tool = HierarchyNavigationTool(graph_db=graph)
    await tool._get_ancestors(CC, 3, False, None)
    await tool._get_siblings(CC, False, None)
    ancestors, siblings = graph.cyphers
    assert "(n)-[:CONTIENE*1..3]->(start)" in ancestors
    assert "(parent)-[:CONTIENE]->(start)" in siblings and "(parent)-[:CONTIENE]->(sibling)" in siblings
    assert "CONTENUTO_IN" not in ancestors + siblings
```

In `tests/unit/test_traversal_inference_steering.py`, the relations are now the schema's: `"deroga"` → `"DEROGA_A"`, `"rinvia"` → `"RINVIA"`, `by_rel["modifica"]` → `by_rel["MODIFICA"]`, `by_rel["deroga"]` → `by_rel["DEROGA_A"]` (the policy names in the fake scores — `DEROGA`, `RIFERIMENTO` — stay). `cita` is no longer a separate candidate, so the cap test caps at one:

```python
def test_extras_are_capped_at_max_extra(monkeypatch):
    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "true")
    pm = _FakePolicyManager(scores={
        "DEROGA": (0.99, math.log(0.99)),       # graph name: DEROGA_A
        "RIFERIMENTO": (0.98, math.log(0.98)),  # graph name: RINVIA
    })
    expert = _make_expert(pm)
    expert.NEURAL_TRAVERSAL_MAX_EXTRA = 1
    chosen = _run(expert._select_traversal_relations(_ctx([0.1] * 8)))
    extras = [r for r in chosen if r not in STATIC_FLOOR]
    assert extras == ["DEROGA_A"]  # only the best one
```

- [ ] **Step 2: Run them to verify they fail**

Run: `… -m pytest tests/unit/test_readers_vocabulary.py tests/unit/test_traversal_inference_steering.py -q -p no:cacheprovider`
Expected: FAIL.

- [ ] **Step 3: Implement**

`tools/search.py`, `_build_traversal_query`:

```python
        if relation_types:
            # The graph's names, whichever vocabulary the caller spoke (legacy
            # lowercase, traversal-weight keys, TraversalPolicy names).
            rel_types = "|".join(resolve_rels(relation_types))
            rel_pattern = rel_pattern.replace("[r*", f"[r:{rel_types}*")
        …
        params = {"start_urn": canonical_urn(start_node)}
```

`experts/systemic.py`:

```python
from merlt.storage.graph.schema import Rel

    STATIC_SYSTEMIC_RELATIONS = [r.value for r in (
        Rel.DISCIPLINA, Rel.MODIFICA, Rel.ABROGA, Rel.INTERPRETA, Rel.IMPONE, Rel.CORRELATO,
    )]

    # Extra candidates the policy may promote (plausible-but-unproven relations).
    NEURAL_EXTRA_CANDIDATE_RELATIONS = [r.value for r in (Rel.DEROGA_A, Rel.RINVIA, Rel.CONTIENE)]
```

(Update the comments above them: the names come from the schema; the `CORRELATO` explanation stays.)

`experts/literal.py`: `GRAPH_RELATIONS = [Rel.CONTIENE.value, Rel.DEFINISCE.value, Rel.DISCIPLINA.value]` on the class, passed as `relation_types=self.GRAPH_RELATIONS`; the source text is `node_text(node.get("properties", {}))`.

`experts/principles.py`: `GRAPH_RELATIONS = [Rel.ESPRIME_PRINCIPIO.value, Rel.DISCIPLINA.value, Rel.INTERPRETA.value, Rel.COMMENTA.value]`, passed as `relation_types`; the text is `node_text(...)` (the seed's principles keep it in `descrizione`).

`experts/precedent.py`: `GRAPH_RELATIONS = [Rel.INTERPRETA.value, Rel.COMMENTA.value, Rel.DISCIPLINA.value, Rel.APPLICA_A.value]`, and at module level

```python
def _case_law_from_node(node: Dict[str, Any], source_urn: str) -> Optional[Dict[str, Any]]:
    """A graph node as a precedent, or None when it is not case law. The seed and
    the ingestion write a massima as `AttoGiudiziario` (text in `massima`, court in
    `organo_emittente`); the older names are still read."""
    node_type = node.get("type", "")
    if node_type != Label.ATTO_GIUDIZIARIO.value and "Massima" not in node_type and "Sentenza" not in node_type:
        return None
    props = node.get("properties", {})
    return {
        "text": node_text(props),
        "urn": node.get("urn", ""),
        "type": node_type,
        "source": "jurisprudence_graph",
        "court": props.get("organo_emittente") or props.get("autorita") or props.get("corte") or "unknown",
        "source_urn": source_urn,
    }
```

used in the loop as `entry = _case_law_from_node(node, urn)` / `if entry: jurisprudence.append(entry)`.

`experts/react_mixin.py`: `"text": props.get("testo_vigente", props.get("testo", ""))` → `"text": node_text(props)`.

`tools/historical_evolution.py`: the default and the caller's list go through the schema (the output keeps lowercasing `event_type`):

```python
        # The graph's names (the schema's), whatever case the caller used.
        rel_types = "|".join(resolve_rels(event_types or [Rel.MODIFICA.value, Rel.ABROGA.value, Rel.SOSTITUISCE.value]))
```

`tools/textual_reference.py`: default `[Rel.RINVIA.value, Rel.MODIFICA.value]`; `rel_pattern = "|".join(resolve_rels(reference_types))`; `target.testo_vigente as excerpt` → `coalesce(target.testo, target.testo_vigente) as excerpt`; the parameter description's example → `['RINVIA', 'MODIFICA']`.

`tools/hierarchy.py`: ancestors `MATCH path = (start)-[:CONTENUTO_IN*1..{max_depth}]->(n)` → `MATCH path = (n)-[:CONTIENE*1..{max_depth}]->(start)`; siblings `MATCH (start)-[:CONTENUTO_IN]->(parent)<-[:CONTENUTO_IN]-(sibling)` → `MATCH (parent)-[:CONTIENE]->(start) MATCH (parent)-[:CONTIENE]->(sibling)`; every `x.testo_vigente AS testo` → `coalesce(x.testo, x.testo_vigente) AS testo`; the docstrings stop mentioning `CONTENUTO_IN`.

`tools/definition.py`: `concept.definizione AS definition_text` → `coalesce(concept.definizione, concept.descrizione) AS definition_text` (the seed stores the text in `descrizione`); every `source.testo_vigente` → `coalesce(source.testo, source.testo_vigente)`.

`storage/temporal/validity_service.py`: `[r_abr:abroga]` → `ABROGA`, `[r_sost:sostituisce]` → `SOSTITUISCE`, `[r:modifica|abroga|sostituisce]` → `[r:MODIFICA|ABROGA|SOSTITUISCE]`; its output keeps lowercase event types: `"type": (mod.get("event_type") or "").lower()`.

`core/legal_knowledge_graph.py`, `_get_graph_context`: `[:contiene]` → `[:CONTIENE]` (twice), `[:modifica|abroga|sostituisce|inserisce]` → `[:MODIFICA|ABROGA|SOSTITUISCE|INSERISCE]`.

`api/graph_router.py`, the article-relations filter: pass `{"relation_type": resolve_rel(relation_type)}`.

`api/engine_bootstrap.py`: remove the two `try` blocks that wire `ConstitutionalBasisTool` and `CitationChainTool`, leaving

```python
        # ConstitutionalBasisTool (ATTUA/RECEPISCE/DERIVA) and CitationChainTool
        # (cita/conferma/supera between decisions) are not wired: no writer
        # produces those relations, so every call returned nothing. Phase 2 of
        # docs/superpowers/specs/2026-09-30-merlt-graph-structure-design.md can
        # rewire the first on RINVIA edges to the Constitution.
```

`storage/retriever/models.py`:

```python
from merlt.storage.graph.schema import EXPERT_SOURCE_TYPES as _BY_EXPERT

# Each expert searches only the chunks of its canon (art. 12 preleggi). The
# schema holds the one list; here it is keyed by both the short and the class name.
EXPERT_SOURCE_TYPES: Dict[str, List[str]] = {
    **_BY_EXPERT,
    **{f"{name.capitalize()}Expert": types for name, types in _BY_EXPERT.items()},
}
```

`storage/retriever/retriever.py`, `_compute_static_relation_bonus`: `edge_type = _edge_type(edge).lower()` (the weight tables are keyed in lower case).

`rlcf/policy_gradient.py`, add to `GRAPH_TO_POLICY_RELATION`:

```python
    "commenta": "INTERPRETED_BY",
    "deroga_a": "DEROGA",
    "inserisce": "MODIFICA",
    "sostituisce": "MODIFICA",
    "esprime_principio": "APPLIES_TO",
    "applica_a": "APPLIES_TO",
    "definisce": "APPLIES_TO",
    "prevede": "APPLIES_TO",
    "prevede_sanzione": "APPLIES_TO",
    "attribuisce_responsabilita": "APPLIES_TO",
    "stabilisce_termine": "APPLIES_TO",
    "esprime": "RELATED_TO",
    "menziona": "RELATED_TO",
    "deriva_da": "RELATED_TO",
```

Delete `storage/graph/validation.py`.

Contract test: `KNOWN_LEGACY_RELS = set()`, `KNOWN_UNKNOWN_LABELS = set()`, and `EXEMPT` gains `ROOT / "tools" / "citation_chain.py"` and `ROOT / "tools" / "constitutional_basis.py"` with the reason given in `engine_bootstrap.py`.

- [ ] **Step 4: Run the MERL-T suite**

Run: `… -m pytest tests -q -p no:cacheprovider` with a disposable Postgres for the DB-backed tests (`services/merlt/CLAUDE.md`, "Tests"); without one, `tests/unit tests/pipeline tests/rlcf tests/scripts` here and the rest in CI.
Expected: PASS, with every `KNOWN_*` set empty.

- [ ] **Step 5: Commit**

```bash
git add -A services/merlt
git commit -m "refactor(merlt): the experts, tools, retriever and policy read the schema's vocabulary"
```

Pull request A ends here: its whole-branch review and the fixes that followed are on capazme/VisuaLexAPI#39, open as a draft. It merges only together with B (header).

---

### Task 5b: Find an article by its URN, not its number

Spec 4.5 (amended 1 October). `FalkorDBClient.get_related_nodes_for_article` (the retriever's and the hybrid retriever's graph enrichment) matches `Norma {numero_articolo}` taken from the URN with `~art(\d+)`: with two codes in the graph art. 52 c.p. gets art. 52 c.c.'s neighbours, and a `bis` article gets none. `ExternalSourceTool._parse_urn_from_query` builds `urn:nir:…;262~artN` and `…;1398~artN` — no URL wrapper, no annex — so its graph lookup never matches a key (the tool is exported, not registered; fixed so that it is right when it is).

Touching `tools/external_source.py` brings its graph lookup into scope for the security rule Task 5's fix round applied to every reader the experts call (OWASP A03): no string the LLM chose reaches the Cypher text, values go in as parameters, and the reader runs `FalkorDBClient.ro_query`, which the server refuses to let write. The other readers do it with `cypher_rel_names`, `cypher_labels` (`storage/graph/schema.py`) and `bounded_int` (`tools/base.py`); this lookup names no relation, label or number, so it needs none of them. Read today: both of its statements already pass their values as parameters, and they run through `query`. Step 4 pins the first and moves them to `ro_query`.

**Files:**
- Modify: `services/merlt/merlt/storage/graph/client.py:~329-410` (`get_related_nodes_for_article`)
- Modify: `services/merlt/merlt/tools/external_source.py:~192-246, 342-372` (`_search_graph`, `_parse_urn_from_query`)
- Test: `services/merlt/tests/unit/test_article_lookup_by_urn.py` (new)

**Interfaces:**
- Consumes: `canonical_urn` (Task 1); `merlt.utils.urngenerator.generate_urn`; `FalkorDBClient.ro_query` (pull request A).
- Produces: `get_related_nodes_for_article(article_urn, max_results)` queries with `{"urn": canonical_urn(article_urn)}`; `ExternalSourceTool._parse_urn_from_query` returns a canonical URN or None; `ExternalSourceTool._search_graph` reads through `graph_db.ro_query`.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/unit/test_article_lookup_by_urn.py
"""An article is found by its canonical URN, never by its number alone."""
from unittest.mock import AsyncMock

import pytest

from merlt.storage.graph.client import FalkorDBClient
from merlt.tools.external_source import ExternalSourceTool

BASE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
CP52 = BASE + "regio.decreto:1930-10-19;1398:1~art52"
CC1453 = BASE + "regio.decreto:1942-03-16;262:2~art1453"


async def test_related_nodes_are_looked_up_by_the_canonical_urn():
    client = FalkorDBClient.__new__(FalkorDBClient)  # no connection: query is replaced
    client.query = AsyncMock(return_value=[])
    await client.get_related_nodes_for_article(CP52 + "!vig=2024-01-01")
    cypher, params = client.query.await_args.args
    assert params == {"urn": CP52}
    assert "numero_articolo" not in cypher


@pytest.mark.parametrize("query, urn", [
    ("art. 52 c.p.", CP52),
    ("articolo 1453 codice civile", CC1453),
    ("art. 2-bis c.p.", BASE + "regio.decreto:1930-10-19;1398:1~art2bis"),
    ("art. 2 bis c.p.", BASE + "regio.decreto:1930-10-19;1398:1~art2bis"),
    ("art. 5 terzo comma c.p.", BASE + "regio.decreto:1930-10-19;1398:1~art5"),
    ("art. 52 c.p.c.", BASE + "regio.decreto:1940-10-28;1443:1~art52"),
    ("art. 52 c.p.p.", BASE + "decreto.del.presidente.della.repubblica:1988-09-22;447~art52"),
    ("urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453", CC1453),
    (CC1453 + "@originale", CC1453),
])
def test_a_citation_becomes_the_graph_key(query, urn):
    assert ExternalSourceTool()._parse_urn_from_query(query) == urn


def test_a_query_without_a_citation_has_no_urn():
    assert ExternalSourceTool()._parse_urn_from_query("risoluzione per inadempimento") is None
```

(`generate_urn("codice penale", article="2-bis")` returns `…;1398:1~art2bis`, checked on 1 October: the form the lazy path writes.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `… -m pytest tests/unit/test_article_lookup_by_urn.py -q -p no:cacheprovider`
Expected: FAIL — the client is called with `{"numero": "52"}`; the tool returns `urn:nir:…;1398~art52`.

- [ ] **Step 3: Implement**

`client.py`, in `get_related_nodes_for_article`: delete the `re` import and the `~art(\d+)` extraction; the Cypher starts `MATCH (n:Norma {URN: $urn})` and the call is `await self.query(cypher, {"urn": canonical_urn(article_urn)})` (import `canonical_urn` from `merlt.storage.graph.schema` at the top). The debug log names the URN instead of `art.{numero_articolo}`.

`external_source.py`:

```python
from merlt.storage.graph.schema import canonical_urn
from merlt.utils.urngenerator import generate_urn

_NORMATTIVA_PREFIX = "https://www.normattiva.it/uri-res/N2Ls?"
_ARTICLE = re.compile(
    r"art(?:\.|icolo)?\s*(\d+(?:\s?-?(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies)\b)?)"
)
# Longer abbreviations first: "c.p." is inside "c.p.c." and "c.p.p.".
_CODES = (("c.p.c.", "codice di procedura civile"), ("codice di procedura civile", "codice di procedura civile"),
          ("c.p.p.", "codice di procedura penale"), ("codice di procedura penale", "codice di procedura penale"),
          ("c.c.", "codice civile"), ("codice civile", "codice civile"),
          ("c.p.", "codice penale"), ("codice penale", "codice penale"))

    def _parse_urn_from_query(self, query: str) -> Optional[str]:
        """The graph key of the article a query cites, or None."""
        text = query.strip()
        if text.startswith("urn:"):
            return canonical_urn(_NORMATTIVA_PREFIX + text)
        if text.startswith(_NORMATTIVA_PREFIX):
            return canonical_urn(text)
        lower = text.lower()
        match = _ARTICLE.search(lower)
        if not match:
            return None
        article = re.sub(r"[\s-]", "", match.group(1))  # "2-bis", "2 bis" → "2bis"
        for marker, act in _CODES:
            if marker in lower:
                return canonical_urn(generate_urn(act, article=article))
        return None
```

(Today "art. 52 c.p.c." resolves to art. 52 of the codice penale: a wrong article, silently. The `\b` keeps "art. 5 terzo comma" from reading as art. 5-ter. The expected URNs of the c.p.c. and c.p.p. cases are `generate_urn`'s output, checked on 1 October.)

- [ ] **Step 4: The graph lookup is read-only and takes the query as a parameter**

Append to `tests/unit/test_article_lookup_by_urn.py`:

```python
class _Graph:
    """A graph that answers read-only calls; a call to `query`, which may write, is recorded."""

    def __init__(self):
        self.ro_query = AsyncMock(return_value=[{"text": "t", "urn": CC1453, "estremi": "Art. 1453 c.c.", "numero": "1453"}])
        self.query = AsyncMock(return_value=[])


@pytest.mark.parametrize("query, params", [
    ("art. 1453 c.c.", {"urn": CC1453}),
    # the text an LLM could pass after reading a hostile document
    ("x' }) DETACH DELETE a //", {"query": "x' }) DETACH DELETE a //"}),
])
async def test_the_graph_lookup_is_read_only_and_takes_the_query_as_a_parameter(query, params):
    graph = _Graph()
    found = await ExternalSourceTool(graph_db=graph)._search_graph(query)
    graph.query.assert_not_awaited()
    cypher, sent = graph.ro_query.await_args.args
    assert sent == params
    assert query not in cypher and "DETACH" not in cypher
    assert "coalesce(a.testo, a.testo_vigente)" in cypher
    assert found["urn"] == CC1453
```

Run it: FAIL — `_search_graph` calls `graph_db.query` (the tool's `except` turns the missing answer into None).

In `_search_graph`, both statements read the text the way the schema's accessor expects and the call is `ro_query`:

```python
        if urn:
            cypher = """
            MATCH (a:Norma {URN: $urn})
            RETURN coalesce(a.testo, a.testo_vigente) AS text, a.URN AS urn,
                   a.estremi AS estremi, a.numero_articolo AS numero
            """
            params = {"urn": urn}
        else:
            cypher = """
            MATCH (a:Norma)
            WHERE a.estremi CONTAINS $query
               OR a.numero_articolo = $query
               OR toLower(coalesce(a.testo, a.testo_vigente, '')) CONTAINS toLower($query)
            RETURN coalesce(a.testo, a.testo_vigente) AS text, a.URN AS urn,
                   a.estremi AS estremi, a.numero_articolo AS numero
            LIMIT 1
            """
            params = {"query": query}

        try:
            result = await self.graph_db.ro_query(cypher, params)
```

The comment above the call says why: the query is the LLM's text, it only ever travels as a parameter, and the read-only call is the second line of defence (Task 5's security ruling).

- [ ] **Step 5: Run the tests to verify they pass**

Run the command of Step 2, then `tests/unit` whole. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/merlt/merlt/storage/graph/client.py services/merlt/merlt/tools/external_source.py services/merlt/tests/unit/test_article_lookup_by_urn.py
git commit -m "fix(merlt): find an article by its canonical URN, not by its number"
```

---

### Task 5c: The benchmark counts an article once

Spec 9 (amended 1 October). The retrieval gate of Task 6b needs metrics that mean what they say. Several chunks of one article (its norma, its ratio, its massime) come back as several hits: graded NDCG goes above 1 (EXP-016 reports 1.02) and recall counts one article several times.

**Files:**
- Modify: `services/merlt/merlt/benchmark/metrics.py` (`distinct_in_order`; `compute_retrieval_metrics`, `compute_graded_relevance_metrics`)
- Modify: `services/merlt/merlt/benchmark/rag_benchmark.py:~355` (`_run_queries_for_source`)
- Test: `services/merlt/tests/unit/test_benchmark_metrics.py` (new)

**Interfaces:**
- Produces: `distinct_in_order(urns: list[str]) -> list[str]`; both aggregate functions score each retrieved list after `distinct_in_order`.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/unit/test_benchmark_metrics.py
"""An article retrieved through several chunks counts once."""
import pytest

from merlt.benchmark.metrics import (
    compute_graded_relevance_metrics,
    compute_retrieval_metrics,
    distinct_in_order,
)

A, B, C = "urn:a", "urn:b", "urn:c"


def test_distinct_in_order_keeps_the_first_occurrence():
    assert distinct_in_order([A, A, B, A, C]) == [A, B, C]


def test_ndcg_never_exceeds_one():
    metrics = compute_graded_relevance_metrics([[A, A, A, B]], [{A: 3, B: 2}])
    assert metrics.ndcg_at_5 == pytest.approx(1.0)
    assert metrics.ndcg_at_10 == pytest.approx(1.0)


def test_a_repeated_article_does_not_push_another_out_of_the_top_five():
    metrics = compute_retrieval_metrics([[A, A, A, A, A, B]], [[A, B]])
    assert metrics.recall_at_5 == pytest.approx(1.0)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `… -m pytest tests/unit/test_benchmark_metrics.py -q -p no:cacheprovider`
Expected: FAIL — `cannot import name 'distinct_in_order'`.

- [ ] **Step 3: Implement**

In `metrics.py`:

```python
def distinct_in_order(urns: List[str]) -> List[str]:
    """Each article once, at its best rank: a search returns chunks, the
    benchmark scores articles."""
    seen: Set[str] = set()
    return [u for u in urns if not (u in seen or seen.add(u))]
```

First statement of `compute_retrieval_metrics` and of `compute_graded_relevance_metrics`: `all_retrieved = [distinct_in_order(r) for r in all_retrieved]`. In `rag_benchmark._run_queries_for_source`: `retrieved_urns = distinct_in_order([r.get("urn", "") for r in search_results])`; `scores` and `source_types` keep the raw lists (they describe the chunks).

- [ ] **Step 4: Run the tests to verify they pass**

Run the command of Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/merlt/merlt/benchmark services/merlt/tests/unit/test_benchmark_metrics.py
git commit -m "fix(merlt): the retrieval benchmark counts an article once"
```

---

### Task 6: Migrate the existing graph and its vectors

Spec 4.4. The script and its tests are the implementer's (Steps 1–5); the run on the development graph is the controller's, last, after Task 6b and the whole-branch review of pull request B (Step 6): it rewrites the development graph, reversible only through the backup, so it runs once, with the dry-run report read first.

The window this task closes: code from A on a graph not yet migrated. The readers miss every edge still named the old way, and `POST /api/v1/graph/search` answers empty until `--apply` re-keys the Qdrant points (A's reader skips the points keyed by an integer; before A it answered 500). Hence A merges only together with B, and `--apply` runs at once (Step 6).

Besides the spec's list, the migration repairs what pull request A's reviews found in the data the old writers left:

- **The old entity writer's stamps.** Before Task 4 it ran `SET art.provenance = coalesce(art.provenance, 'community_validated'), art.trust = coalesce(art.trust, 1.0)` on every article it linked an entity to. The community validated the link, which carries its own provenance; the article gets back `seed` or `ingestion`, and no `trust`.
- **Twins, both ways.** The seed key comes from the name by the writer's rule (`seed_twin_slugs`: `seed_twin_slug` as spelt, then without a leading article), never from the community id, which drops accents and hyphens. A seed name may keep its article where the proposal drops it (13 of the seed's 19 article-bearing names have no article-less node), so seed names are indexed under both their keys too. Seed nodes whose names give one community id ("La reticenza", "reticenza": 8 pairs, 16 nodes, on the Libro IV seed) are reported as near-duplicates.
- **Community entity labels.** The writer before Task 4 labelled a community entity `:Entity:<tipo.capitalize()>` (`Concetto`, `Principio`). Each gains the label of its kind from `schema.ENTITY_LABEL_BY_TYPE` (`entity_label`), idempotently; the label is taken from the map, never from the node. The old label goes (controller's ruling): `LEGACY_ENTITY_LABELS` is a fixed set the script builds from `EntityType` (`tipo.capitalize()` for every type), and every name in it is removed from an `:Entity` node unless it is the label `entity_label(tipo)` gives that node. A reader takes a node's type from its first label that is not `Entity`, and FalkorDB orders labels by creation, so a left-over `Concetto` would read as the type in a graph where it was created before the seed's labels; and a community `norma` entity written `:Entity:Norma` would be matched as a norm by every `(n:Norma)` step. This step runs first, before any step that matches `Norma`. The names come from the code's set, never from the node; `tipo` goes in as a parameter. The development graph has no such node; another graph may.
- **Provenance outside the schema.** The ingestion before this round stamped `lazy_ingest` (trust 0.6, see `merlt/scripts/backfill_provenance_seed.py`): it becomes `ingestion`. Any other value outside `Provenance` is reported and left alone. The comment in `merlt/storage/graph/entity_writer.py` (~426) that names `lazy_ingest` is corrected to `ingestion`.
- **Community entity key.** Community entities carry `id` only, so `get_article_relations` answers a null `target_urn` and `get_article_entities` FalkorDB's internal id. Every community entity also carries `node_id = id` (controller's ruling): the entity writer writes it, the migration sets `node_id = coalesce(e.node_id, e.id)`, and the readers that return a node's key read `coalesce(URN, node_id)`. Task 1b indexes `(Entity, node_id)`.
- **Doubled version keys** (Task 1b). The versions multivigenza keyed `…!vig=!vig=<date>` get `version_urn`'s key and their `VERSIONE_DI` edge to the article.
- **Stale live-source text.** A `LiveSource` the provisional writer refreshed after Task 4 has `testo` and still its old `text`: the old one goes.
- **Bare keys.** A `Norma` keyed by a bare `urn:nir:` URN is unreachable. Its key becomes the full Normattiva URL when no node holds that URL; when one does, it is reported (two nodes for one norm: merging them is a decision, and FalkorDB has no APOC). The development graph has one: `urn:nir:stato:codice.penale:1930-10-19;1398~art52`.

**Files:**
- Create: `services/merlt/merlt/scripts/migrate_graph_vocabulary.py`
- Modify: `services/merlt/merlt/storage/graph/entity_writer.py` (`_create_new_entity_node` writes `node_id`)
- Modify: `services/merlt/merlt/api/graph_router.py:~264` (`get_article_entities` returns `COALESCE(e.URN, e.node_id)`)
- Test: `services/merlt/tests/scripts/test_migrate_graph_vocabulary.py` (unit: estremi plan, Qdrant in memory), `services/merlt/tests/scripts/test_migrate_graph_vocabulary_integration.py` (`integration`: throwaway FalkorDB), `services/merlt/tests/unit/test_writers_vocabulary.py` (append), `services/merlt/tests/api/test_article_entity_key.py` (new), `services/merlt/tests/storage/test_entity_writer_twins.py` (append, `integration`)
- Modify: `services/merlt/tests/unit/test_graph_vocabulary_contract.py` (`EXEMPT` gains the script: it must name the old relations to rename them)

**Interfaces:**
- Consumes: `LEGACY_REL`, `LEGACY_SOURCE_TYPE`, `Label`, `Provenance`, `Rel`, `SEED_TWIN`, `canonical_urn`, `act_name_from_urn`, `estremi_from_urn`, `normalize_fonte`, `point_id`, `text_fingerprint` (Task 1); `entity_label` (pull request A); `version_urn` (Task 1b); `normalize_entity_name`, `seed_twin_slugs` (`merlt.storage.graph.entity_writer`); `wrapped_norm_key` (`merlt.storage.graph.relation_endpoints`); `FalkorDBClient`; `qdrant_client`; `merlt.scripts.load_seed_libro_iv.SEED_GRAPH_JSON`; `merlt.storage.vectors.collection.default_chunks_collection`.
- Produces: `python -m merlt.scripts.migrate_graph_vocabulary [--apply] [--batch N]` printing `{"applied", "graph": {"relations_collapsed", "relations", "legacy_entity_labels", "bare_keys", "versions", "stubs", "provenance_reset", "estremi", "provenance_legacy", "provenance", "fonte", "testo", "stale_text", "fingerprint", "entity_labels", "entity_node_id", "twins"}, "vectors": {"rekeyed", "duplicates_dropped", "retyped", "urns_canonicalized", "unkeyed"}}` (`stubs` is `{"reshaped", "set", "removed", "reported"}`); `async migrate_graph(client, *, apply, batch, seed_keys) -> dict`; `migrate_qdrant(client, collection, *, apply, batch=256) -> dict`; `plan_estremi(rows) -> list[dict]`; `plan_qdrant(points) -> dict`. A community entity carries `node_id` equal to its `id`.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/scripts/test_migrate_graph_vocabulary.py
"""The migration's pure parts and its vector half (Qdrant in memory)."""
from qdrant_client import QdrantClient, models

from merlt.scripts import migrate_graph_vocabulary as mig
from merlt.storage.graph.schema import point_id

CODE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2"
CC = CODE + "~art2043"
SEED_ID = "5c56c793-69f3-4fbf-87e6-c4bf54c28c26"


def test_estremi_are_rewritten_only_for_codes_the_table_knows():
    rows = [
        {"id": 1, "urn": CODE + "~art1321", "estremi": "Art. 1321 codice civile"},
        {"id": 2, "urn": CODE + "~art1322", "estremi": "Art. 1322 c.c."},
        {"id": 3, "urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1992-02-17;154~art11", "estremi": "Art. 11 L. 154/1992"},
    ]
    assert mig.plan_estremi(rows) == [{"id": 1, "estremi": "Art. 1321 c.c."}]


def _collection() -> QdrantClient:
    client = QdrantClient(":memory:")
    client.create_collection("chunks", vectors_config=models.VectorParams(size=4, distance=models.Distance.COSINE))
    client.upsert("chunks", points=[
        models.PointStruct(id=123456789, vector=[1, 0, 0, 0], payload={"article_urn": CC, "source_type": "norma", "text": "a"}),
        # the same article, ingested by another process: another hash() id
        models.PointStruct(id=987654321, vector=[1, 0, 0, 0], payload={"article_urn": CC, "source_type": "norma", "text": "a"}),
        models.PointStruct(id=555, vector=[0, 1, 0, 0], payload={"article_urn": CC, "source_type": "massima", "massima_index": 2, "text": "m"}),
        models.PointStruct(id=SEED_ID, vector=[0, 0, 1, 0], payload={"article_urn": "concetto:accordo", "source_type": "concettogiuridico", "text": "c"}),
    ])
    return client


def test_lazy_points_get_stable_ids_and_duplicates_go():
    client = _collection()
    report = mig.migrate_qdrant(client, "chunks", apply=True)
    assert report == {"rekeyed": 2, "duplicates_dropped": 1, "retyped": {"concettogiuridico": 1}, "urns_canonicalized": 0}
    ids = {str(p.id) for p in client.scroll("chunks", limit=10)[0]}
    assert ids == {point_id(CC, "norma"), point_id(CC, "massima", 2), SEED_ID}
    assert client.retrieve("chunks", ids=[SEED_ID])[0].payload["source_type"] == "concetto"


def test_a_second_run_changes_nothing():
    client = _collection()
    mig.migrate_qdrant(client, "chunks", apply=True)
    assert mig.migrate_qdrant(client, "chunks", apply=True) == {
        "rekeyed": 0, "duplicates_dropped": 0, "retyped": {}, "urns_canonicalized": 0,
    }


def test_a_dry_run_reports_and_writes_nothing():
    client = _collection()
    assert mig.migrate_qdrant(client, "chunks", apply=False)["rekeyed"] == 2
    assert len(client.scroll("chunks", limit=10)[0]) == 4


def test_a_crash_between_upsert_and_delete_converges():
    # The new point was written and the old one survived: the old one is a duplicate.
    plan = mig.plan_qdrant([
        (123, {"article_urn": CC, "source_type": "norma"}),
        (point_id(CC, "norma"), {"article_urn": CC, "source_type": "norma"}),
    ])
    assert plan["rekey"] == [] and plan["drop"] == [123]
```

```python
# services/merlt/tests/scripts/test_migrate_graph_vocabulary_integration.py
"""The migration against a real FalkorDB — a throwaway one, never the stack's.

It writes to a graph of its own (`merlt_test_migration`), wiped before and after. The
client reads FALKORDB_HOST and FALKORDB_PORT: CI sets them for its integration step;
locally,

    docker run -d --rm --name vx-mig-falkor -p 127.0.0.1:6399:6379 falkordb/falkordb
    FALKORDB_HOST=host.docker.internal FALKORDB_PORT=6399 python -m pytest tests/scripts -m integration
"""
import pytest
import pytest_asyncio

from merlt.scripts import migrate_graph_vocabulary as mig
from merlt.storage.graph import FalkorDBClient
from merlt.storage.graph.schema import text_fingerprint

pytestmark = pytest.mark.integration

PREFIX = "https://www.normattiva.it/uri-res/N2Ls?"
CODE = PREFIX + "urn:nir:stato:regio.decreto:1942-03-16;262:2"
ART, STUB, ART3 = CODE + "~art1321", CODE + "~art1322", CODE + "~art1323"
TEXT = "Testo dell'articolo."
DOTTRINA = "dottrina_brocardi_art1321_ratio"
SEED_KEYS = {ART, DOTTRINA}
BARE_CP = "urn:nir:stato:codice.penale:1930-10-19;1398~art52"  # the development graph's one bare key

LEGACY = """
CREATE (codice:Norma {URN: $code, tipo_documento: 'codice', fonte: 'VisualexAPI'}),
       (a:Norma {URN: $art, numero_articolo: '1321', tipo_documento: 'articolo',
                 estremi: 'Art. 1321 codice civile', testo_vigente: $text, fonte: 'VisualexAPI'}),
       (s:Norma {URN: $stub, numero_articolo: '1322', estremi: 'Art. 1322',
                 provenance: 'community_validated', trust: 1.0}),
       (d:Dottrina {node_id: $dottrina, fonte: 'Brocardi', descrizione: 'Ratio'}),
       (e:Entity:Concetto {id: 'concetto:accordo', tipo: 'concetto'}),
       (ls:LiveSource {node_id: 'live:abc', text: 'fonte live', provenance: 'live_unconfirmed'}),
       (codice)-[:contiene]->(a),
       (d)-[:commenta {certezza: 0.9, fonte: 'Brocardi.it'}]->(a),
       (a)-[:CITA]->(s),
       (e)-[:CITA {fonte: 'community_validation'}]->(ls)
"""

NO_TWINS = {"community": [], "seed_near_duplicates": []}

# What a run reports when it has nothing to change.
NOTHING = {
    "relations": {}, "legacy_entity_labels": {}, "bare_keys": {"wrapped": 0, "reported": []},
    "versions": {"rekeyed": 0, "linked": 0, "reported": []}, "stubs": 0, "provenance_reset": {}, "estremi": 0,
    "provenance_legacy": {"remapped": {}, "unknown": {}}, "provenance": {}, "fonte": {}, "testo": 0, "stale_text": 0,
    "fingerprint": 0, "entity_labels": {}, "entity_node_id": 0, "twins": NO_TWINS,
}


@pytest_asyncio.fixture
async def graph():
    client = FalkorDBClient(graph_name="merlt_test_migration")
    await client.connect()
    await client.query("MATCH (n) DETACH DELETE n")
    await client.query(LEGACY, {"code": CODE, "art": ART, "stub": STUB, "text": TEXT, "dottrina": DOTTRINA})
    yield client
    try:
        await client.query("MATCH (n) DETACH DELETE n")
    finally:
        await client.close()


async def _migrate(client, seed_keys=SEED_KEYS) -> dict:
    return await mig.migrate_graph(client, apply=True, batch=2, seed_keys=seed_keys)


async def _types(client) -> set[str]:
    return {row["t"] for row in await client.query("MATCH ()-[r]->() RETURN DISTINCT type(r) AS t")}


async def test_the_migration_converges_on_the_schema(graph):
    report = await _migrate(graph)
    assert report == {
        **NOTHING,
        "relations": {"CITA→DERIVA_DA": 1, "contiene": 1, "commenta": 1, "CITA": 1},
        "stubs": 1,
        "estremi": 2,
        "provenance": {"seed": 2, "ingestion": 1},
        "fonte": {"VisualexAPI": 2, "Brocardi": 1, "community_validation": 1},
        "testo": 2,
        "fingerprint": 1,
        "entity_labels": {"ConcettoGiuridico": 1},
        "entity_node_id": 1,
    }
    assert await _types(graph) == {"CONTIENE", "COMMENTA", "RINVIA", "DERIVA_DA"}
    assert await graph.query("MATCH (:Dottrina)-[r:COMMENTA]->() RETURN r.certezza AS c, r.fonte AS f") == [{"c": 0.9, "f": "Brocardi.it"}]
    art = await graph.query(
        "MATCH (n:Norma {URN: $u}) RETURN n.estremi AS e, n.testo AS t, n.testo_sha256 AS h, n.provenance AS p, n.fonte AS f",
        {"u": ART},
    )
    assert art == [{"e": "Art. 1321 c.c.", "t": TEXT, "h": text_fingerprint(TEXT), "p": "seed", "f": "Normattiva"}]
    stub = await graph.query(
        "MATCH (n:Norma {URN: $u}) RETURN n.is_stub AS s, n.trust AS t, n.provenance AS p, n.node_id AS id, n.estremi AS e",
        {"u": STUB},
    )
    assert stub == [{"s": True, "t": None, "p": "ingestion", "id": STUB, "e": "Art. 1322 c.c."}]
    assert await graph.query("MATCH (n:LiveSource) RETURN n.testo AS t, n.text AS old") == [{"t": "fonte live", "old": None}]


async def test_a_dry_run_reports_the_same_and_writes_nothing(graph):
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=SEED_KEYS)
    assert await _types(graph) == {"contiene", "commenta", "CITA"}
    assert dry == await _migrate(graph)


async def test_a_second_run_changes_nothing(graph):
    await _migrate(graph)
    assert await _migrate(graph) == NOTHING


async def test_an_edge_already_written_under_its_new_name_is_kept_and_the_legacy_one_goes(graph):
    # Between the merge of A and B and --apply, a new writer may have linked the same two nodes.
    await graph.query(
        "MATCH (c:Norma {URN: $code}), (a:Norma {URN: $art}) CREATE (c)-[:CONTIENE {fonte: 'Normattiva'}]->(a)",
        {"code": CODE, "art": ART},
    )
    assert (await _migrate(graph))["relations"]["contiene"] == 1
    edges = await graph.query(
        "MATCH (:Norma {URN: $code})-[r]->(:Norma {URN: $art}) RETURN type(r) AS t, r.fonte AS f",
        {"code": CODE, "art": ART},
    )
    assert edges == [{"t": "CONTIENE", "f": "Normattiva"}]  # one edge, with its own properties


async def test_an_article_the_old_entity_writer_stamped_gets_its_own_provenance_back(graph):
    await graph.query(
        "CREATE (:Norma {URN: $u, node_id: $u, tipo_documento: 'articolo', numero_articolo: '1323', "
        "estremi: 'Art. 1323 c.c.', testo: 'Altro testo.', provenance: 'community_validated', trust: 1.0})",
        {"u": ART3},
    )
    seed_keys = SEED_KEYS | {ART3}
    # the fixture's stub carries the same stamp: unify_stubs resets it, not this step
    assert (await _migrate(graph, seed_keys))["provenance_reset"] == {"seed": 1}
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.provenance AS p, n.trust AS t", {"u": ART3}) == [
        {"p": "seed", "t": None}
    ]
    assert (await _migrate(graph, seed_keys))["provenance_reset"] == {}


TWINS = """
CREATE (:ConcettoGiuridico {node_id: 'concetto:la_convalida', nome: 'La convalida'}),
       (:ConcettoGiuridico {node_id: 'concetto:conduttore', nome: 'conduttore'}),
       (:ConcettoGiuridico {node_id: 'concetto:la_reticenza', nome: 'La reticenza'}),
       (:ConcettoGiuridico {node_id: 'concetto:reticenza', nome: 'reticenza'}),
       (:Entity:Concetto {id: 'concetto:convalida', nome: 'Convalida', tipo: 'concetto'}),
       (:Entity:Concetto {id: 'concetto:conduttore', nome: 'Il conduttore', tipo: 'concetto'}),
       (:Entity:Concetto {id: 'concetto:mora', nome: 'Mora', tipo: 'concetto'})
"""


async def test_twins_are_reported_both_ways_with_the_seeds_near_duplicates(graph):
    await graph.query(TWINS)
    report = await _migrate(graph)
    assert report["twins"] == {
        # the proposal drops the article the seed keeps; the proposal adds one the seed does not have
        "community": [
            {"id": "concetto:conduttore", "seed": ["concetto:conduttore"]},
            {"id": "concetto:convalida", "seed": ["concetto:la_convalida"]},
        ],
        # two seed nodes the community names with one id: the writer adopts only the first it meets
        "seed_near_duplicates": [["concetto:la_reticenza", "concetto:reticenza"]],
    }
    # reported, never merged: the next run reports them again
    assert (await _migrate(graph))["twins"] == report["twins"]


async def test_community_entities_get_the_label_of_their_kind_and_a_node_id(graph):
    await graph.query(
        "CREATE (:Entity {id: 'principio:buona_fede', tipo: 'principio'}), "
        "(:Entity {id: 'norma:x', tipo: 'norma'}), (:Entity {id: 'x:y', tipo: $attack})",
        {"attack": "Concetto) DETACH DELETE n //"},
    )
    report = await _migrate(graph)
    # the label comes from schema.ENTITY_LABEL_BY_TYPE; a type the map does not name gets none
    assert report["entity_labels"] == {"ConcettoGiuridico": 1, "PrincipioGiuridico": 1}
    assert report["entity_node_id"] == 4
    rows = await graph.query("MATCH (e:Entity) RETURN e.id AS id, labels(e) AS labels, e.node_id AS nid")
    assert {row["id"]: (set(row["labels"]), row["nid"]) for row in rows} == {
        "concetto:accordo": ({"Entity", "ConcettoGiuridico"}, "concetto:accordo"),
        "principio:buona_fede": ({"Entity", "PrincipioGiuridico"}, "principio:buona_fede"),
        "norma:x": ({"Entity"}, "norma:x"),
        "x:y": ({"Entity"}, "x:y"),
    }
    again = await _migrate(graph)
    assert (again["entity_labels"], again["entity_node_id"]) == ({}, 0)


async def test_a_community_entity_loses_the_label_the_old_writer_gave_it(graph):
    await graph.query(
        "CREATE (:Entity:Norma {id: 'norma:y', tipo: 'norma'}), "
        "(:Entity:Sanzione {id: 'sanzione:z', tipo: 'sanzione'}), "
        "(:Entity:Concetto {id: 'concetto:w', tipo: 'concetto'})"
    )
    report = await _migrate(graph)
    # Norma and Concetto came from tipo.capitalize(); Sanzione is the schema label of its kind
    assert report["legacy_entity_labels"] == {"Norma": 1, "Concetto": 1}
    rows = await graph.query("MATCH (e:Entity) WHERE e.id IN ['norma:y', 'sanzione:z', 'concetto:w'] RETURN e.id AS id, labels(e) AS labels")
    assert {row["id"]: set(row["labels"]) for row in rows} == {
        "norma:y": {"Entity"},
        "sanzione:z": {"Entity", "Sanzione"},
        "concetto:w": {"Entity", "ConcettoGiuridico"},
    }
    # a community norma entity was never a norm: no Norma step touched it
    assert await graph.query("MATCH (n:Norma) WHERE n.id = 'norma:y' RETURN n") == []
    assert (await _migrate(graph))["legacy_entity_labels"] == {}


async def test_a_provenance_from_before_this_round_becomes_the_schema_value(graph):
    await graph.query(
        "CREATE (:Norma {URN: $a, provenance: 'lazy_ingest'}), (:Norma {URN: $b, provenance: 'handmade'})",
        {"a": ART + "-legacy-a", "b": ART + "-legacy-b"},
    )
    report = await _migrate(graph)
    assert report["provenance_legacy"] == {"remapped": {"lazy_ingest": 1}, "unknown": {"handmade": 1}}
    rows = await graph.query("MATCH (n:Norma) WHERE n.URN IN [$a, $b] RETURN n.URN AS u, n.provenance AS p", {"a": ART + "-legacy-a", "b": ART + "-legacy-b"})
    assert {row["u"]: row["p"] for row in rows} == {ART + "-legacy-a": "ingestion", ART + "-legacy-b": "handmade"}
    assert (await _migrate(graph))["provenance_legacy"] == {"remapped": {}, "unknown": {"handmade": 1}}


async def test_a_doubled_version_key_is_rekeyed_and_linked_to_its_article(graph):
    doubled = ART + "!vig=!vig=2020-01-01"
    await graph.query(
        "CREATE (:Norma {URN: $u, node_id: $u, tipo_documento: 'versione_storica', testo_storico: 'Vecchio testo.'})",
        {"u": doubled},
    )
    assert (await _migrate(graph))["versions"] == {"rekeyed": 1, "linked": 1, "reported": []}
    assert await graph.query(
        "MATCH (v:Norma {tipo_documento: 'versione_storica'})-[:VERSIONE_DI]->(a:Norma) "
        "RETURN v.URN AS v, v.node_id AS id, a.URN AS a"
    ) == [{"v": ART + "!vig=2020-01-01", "id": ART + "!vig=2020-01-01", "a": ART}]
    assert (await _migrate(graph))["versions"] == {"rekeyed": 0, "linked": 0, "reported": []}


async def test_a_live_source_keeps_only_its_current_text(graph):
    await graph.query("CREATE (:LiveSource {node_id: 'live:def', testo: 'nuovo', text: 'vecchio'})")
    assert (await _migrate(graph))["stale_text"] == 1
    assert await graph.query("MATCH (n:LiveSource {node_id: 'live:def'}) RETURN n.testo AS t, n.text AS old") == [
        {"t": "nuovo", "old": None}
    ]


async def test_a_bare_key_is_wrapped_unless_its_url_is_taken(graph):
    held = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art1324"
    await graph.query(
        "CREATE (:Norma {URN: $cp}), (:Norma {URN: $held}), "
        "(:Norma {URN: $url, node_id: $url, tipo_documento: 'articolo', testo: 'Testo.'})",
        {"cp": BARE_CP, "held": held, "url": PREFIX + held},
    )
    assert (await _migrate(graph))["bare_keys"] == {"wrapped": 1, "reported": [held]}
    assert await graph.query(
        "MATCH (n:Norma {URN: $u}) RETURN n.node_id AS id, n.is_stub AS s", {"u": PREFIX + BARE_CP}
    ) == [{"id": PREFIX + BARE_CP, "s": True}]
    # two nodes for one norm wait for a decision: reported on every run, changed by none
    assert (await _migrate(graph))["bare_keys"] == {"wrapped": 0, "reported": [held]}
```

Append to `tests/unit/test_writers_vocabulary.py`:

```python
async def test_a_new_community_entity_carries_its_id_as_node_id():
    # Readers name a node by coalesce(URN, node_id): with `id` alone a community entity had no key.
    writer, client = _writer(rows=[{"id": "principio:buona_fede"}])
    await writer._create_new_entity_node(_proposal("principio"))
    cypher, params = client.query.await_args.args
    assert "node_id: $id" in cypher
    assert params["id"] == "principio:buona_fede"
```

```python
# services/merlt/tests/api/test_article_entity_key.py
"""The article-entities reader names a node by its key, never by FalkorDB's internal id."""
from unittest.mock import AsyncMock, MagicMock, patch

from merlt.api.graph_router import get_article_entities

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1322"


async def test_article_entities_are_named_by_urn_or_node_id():
    client = MagicMock(connect=AsyncMock(), close=AsyncMock(), query=AsyncMock(return_value=[]), ro_query=AsyncMock(return_value=[]))
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        await get_article_entities(CC, validation_status=None, api_key=None)
    cypher = (client.query.await_args or client.ro_query.await_args).args[0]
    assert "COALESCE(e.URN, e.node_id) as entity_id" in cypher
    assert "id(e)" not in cypher  # an internal id changes when a node is recreated: no client can keep it
```

Append to `tests/storage/test_entity_writer_twins.py` (add `import importlib` and `from unittest.mock import patch` to its imports):

```python
class _Lent:
    """The router opens and closes its own client: lend it the test's connected one."""

    def __init__(self, client):
        self._client = client

    async def connect(self):
        pass

    async def close(self):
        pass

    async def query(self, *args):
        return await self._client.query(*args)

    async def ro_query(self, *args):
        return await self._client.ro_query(*args)


async def test_the_article_readers_name_a_community_entity_by_its_key(graph):
    await graph.query("CREATE (:Norma {URN: $u, node_id: $u, provenance: 'seed'})", {"u": ART_1322})
    await EntityGraphWriter(graph).write_entity(_approved("pe-1", "sanzione", "Multa"))

    assert await graph.query("MATCH (e:Entity {id: 'sanzione:multa'}) RETURN e.node_id AS nid", {}) == [
        {"nid": "sanzione:multa"}
    ]
    graph_router = importlib.import_module("merlt.api.graph_router")
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=_Lent(graph)):
        relations = await graph_router.get_article_relations(ART_1322, relation_type=None, api_key=None)
        entities = await graph_router.get_article_entities(ART_1322, validation_status=None, api_key=None)
    # before: a null target_urn, and FalkorDB's internal id
    assert [r["target_urn"] for r in relations["relations"]] == ["sanzione:multa"]
    assert [e["entity_id"] for e in entities["entities"]] == ["sanzione:multa"]
```

- [ ] **Step 2: Run the unit tests; start a throwaway FalkorDB and run the integration tests**

```bash
docker run --rm -v "$PWD/services/merlt:/app" -w /app --entrypoint python visualex-merlt-worker:latest -m pytest tests/scripts/test_migrate_graph_vocabulary.py tests/unit/test_writers_vocabulary.py tests/api/test_article_entity_key.py -q -p no:cacheprovider
docker run -d --rm --name vx-mig-falkor -p 127.0.0.1:6399:6379 falkordb/falkordb
docker run --rm -e FALKORDB_HOST=host.docker.internal -e FALKORDB_PORT=6399 -v "$PWD/services/merlt:/app" -w /app --entrypoint python visualex-merlt-worker:latest -m pytest tests/scripts/test_migrate_graph_vocabulary_integration.py tests/storage/test_entity_writer_twins.py -m integration -q -p no:cacheprovider
```

Expected: FAIL — no module `merlt.scripts.migrate_graph_vocabulary`; the entity writer writes no `node_id`; the article-entities reader still falls back to `id(e)`; live, the readers answer `None` and an integer. In CI the same integration tests run in the `-m integration` step, against the job's FalkorDB.

- [ ] **Step 3: Write the script, the entity key and the reader**

```python
# services/merlt/merlt/scripts/migrate_graph_vocabulary.py
"""Migrate the MERL-T graph and its vectors to the schema's vocabulary.

Dry run by default: it reads and reports. `--apply` writes. Idempotent: a second
run changes nothing; what it only reports (twins, a key two nodes would share)
it reports again. Run `scripts/backup.sh` first.
Design: docs/superpowers/specs/2026-09-30-merlt-graph-structure-design.md, §4.4.

    python -m merlt.scripts.migrate_graph_vocabulary            # report
    python -m merlt.scripts.migrate_graph_vocabulary --apply    # write
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
from typing import Any, Iterable

import structlog

from merlt.storage.graph import FalkorDBClient
from merlt.pipeline.enrichment.models import EntityType
from merlt.storage.graph.entity_writer import normalize_entity_name, seed_twin_slugs
from merlt.storage.graph.relation_endpoints import wrapped_norm_key
from merlt.storage.graph.schema import (
    LEGACY_REL, LEGACY_SOURCE_TYPE, SEED_TWIN, Label, Provenance, Rel,
    act_name_from_urn, canonical_urn, entity_label, estremi_from_urn, normalize_fonte, point_id,
    text_fingerprint, version_urn,
)

log = structlog.get_logger()

# Every label that carries content; community entities and live sources stamp their own provenance.
PROVENANCE_LABELS = [label for label in Label if label not in (Label.ENTITY, Label.LIVE_SOURCE)]
_STUB_WHERE = "(n.is_stub = true OR (n.tipo_documento IS NULL AND n.testo IS NULL AND n.testo_vigente IS NULL))"
# The same test, null-safe, negated: an article or an act, not a placeholder.
_NOT_STUB_WHERE = (
    "NOT (coalesce(n.is_stub, false) OR (n.tipo_documento IS NULL AND n.testo IS NULL AND n.testo_vigente IS NULL))"
)


def _chunks(items: list, size: int) -> Iterable[list]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


async def _count(client, cypher: str, params: dict | None = None) -> int:
    rows = await client.query(cypher, params or {})
    return int(rows[0]["n"]) if rows else 0


async def _norma_holds(client, key: str) -> bool:
    return bool(await _count(client, "MATCH (m:Norma {URN: $u}) RETURN count(m) AS n", {"u": key}))


async def rename_relations(client, apply: bool, batch: int) -> dict[str, int]:
    """FalkorDB cannot rename a relation type: each legacy edge is merged into its
    canonical type, then deleted — in batches, one statement each (atomic per batch).

    MERGE, not CREATE: between the merge of pull requests A and B and `--apply`,
    the new writers may already have linked the same two nodes under the new name.
    That edge stays as it is, with its own properties; a new edge takes the legacy
    edge's properties; the legacy edge goes in every case."""
    # A community entity's link to its live source was written CITA; it is DERIVA_DA.
    plans = [("CITA", Rel.DERIVA_DA, "WHERE a:Entity AND b:LiveSource", "CITA→DERIVA_DA")]
    plans += [
        (old, new, "WHERE NOT (a:Entity AND b:LiveSource)" if old == "CITA" else "", old)
        for old, new in LEGACY_REL.items()
    ]
    report: dict[str, int] = {}
    for old, new, where, key in plans:
        match = f"MATCH (a)-[r:`{old}`]->(b) {where}"
        count = await _count(client, f"{match} RETURN count(r) AS n")
        if not count:
            continue
        report[key] = count
        while apply:
            moved = await _count(
                client,
                f"{match} WITH a, r, b LIMIT {batch} "
                f"MERGE (a)-[nr:`{new.value}`]->(b) ON CREATE SET nr = properties(r) "
                "DELETE r RETURN count(*) AS n",
            )
            if not moved:
                break
    return report


async def wrap_bare_keys(client, apply: bool) -> dict[str, Any]:
    """A Norma keyed by a bare `urn:nir:` URN is unreachable: the graph keys a norm by
    its full Normattiva URL (the seed does). The key becomes that URL when no node
    holds it; when one does, the bare key is reported (two nodes for one norm:
    merging them is a decision, and FalkorDB has no APOC). Versions are
    `rekey_versions`' job."""
    rows = await client.query(
        "MATCH (n:Norma) WHERE n.URN STARTS WITH 'urn:nir:' "
        "AND coalesce(n.tipo_documento, '') <> 'versione_storica' RETURN id(n) AS id, n.URN AS urn"
    )
    wrapped, reported = 0, []
    for row in rows:
        new = canonical_urn(wrapped_norm_key(row["urn"]))
        if await _norma_holds(client, new):
            reported.append(row["urn"])
            continue
        wrapped += 1
        if apply:
            await client.query(
                "MATCH (n) WHERE id(n) = $id SET n.URN = $new, "
                "n.node_id = CASE WHEN n.node_id IS NULL OR n.node_id = $old THEN $new ELSE n.node_id END",
                {"id": row["id"], "old": row["urn"], "new": new},
            )
    return {"wrapped": wrapped, "reported": sorted(reported)}


async def rekey_versions(client, apply: bool) -> dict[str, Any]:
    """Past versions (multivigenza). Before Task 1b the writer keyed one
    `<URN>!vig=!vig=<date>` and linked it to an article keyed `<URN>!vig=`, which no
    node has. Each such version gets `version_urn`'s key (reported instead when a node
    holds it already), and every version without its VERSIONE_DI edge is linked to its
    article when the article is in the graph."""
    rekeyed, linked, reported = 0, 0, []
    for row in await client.query("MATCH (v:Norma) WHERE v.URN CONTAINS '!vig=!vig=' RETURN id(v) AS id, v.URN AS urn"):
        old = row["urn"]
        date = old.rsplit("!vig=", 1)[1]
        new = version_urn(old, date)
        if not date or await _norma_holds(client, new):
            reported.append(old)
            continue
        rekeyed += 1
        if apply:
            await client.query(
                "MATCH (v) WHERE id(v) = $id SET v.URN = $new, "
                "v.node_id = CASE WHEN v.node_id IS NULL OR v.node_id = $old THEN $new ELSE v.node_id END",
                {"id": row["id"], "old": old, "new": new},
            )
    for row in await client.query(
        "MATCH (v:Norma {tipo_documento: 'versione_storica'}) WHERE NOT (v)-[:VERSIONE_DI]->() RETURN v.URN AS urn"
    ):
        article = canonical_urn(row["urn"])
        if not article or article == row["urn"] or not await _norma_holds(client, article):
            continue
        linked += 1
        if apply:
            await client.query(
                "MATCH (v:Norma {URN: $ver_urn}) MATCH (a:Norma {URN: $art_urn}) "
                "MERGE (v)-[r:VERSIONE_DI]->(a) ON CREATE SET r.certezza = 1.0",
                {"ver_urn": row["urn"], "art_urn": article},
            )
    return {"rekeyed": rekeyed, "linked": linked, "reported": sorted(reported)}


async def unify_stubs(client, apply: bool) -> int:
    """One stub shape: `is_stub`, `node_id`, `provenance` ingestion, no `trust`."""
    match = (
        f"MATCH (n:Norma) WHERE {_STUB_WHERE} AND (n.is_stub IS NULL OR n.trust IS NOT NULL "
        "OR n.node_id IS NULL OR n.provenance IS NULL OR n.provenance = 'community_validated')"
    )
    count = await _count(client, f"{match} RETURN count(n) AS n")
    if apply and count:
        await client.query(
            f"{match} SET n.is_stub = true, n.node_id = coalesce(n.node_id, n.URN), n.trust = NULL, "
            "n.provenance = CASE WHEN n.provenance IS NULL OR n.provenance = 'community_validated' "
            "THEN 'ingestion' ELSE n.provenance END"
        )
    return count


async def reset_entity_writer_stamps(client, apply: bool, batch: int, seed_keys: set[str]) -> dict[str, int]:
    """Before Task 4 the entity writer stamped the article it linked an entity to:
    `provenance = coalesce(provenance, 'community_validated')`, `trust = coalesce(trust,
    1.0)`. The community validated the link, which carries its own provenance, not the
    article. Stubs are unify_stubs' job; an article or an act gets what stamp_provenance
    would give it (`seed` or `ingestion`) and no trust. Written here, not left to
    stamp_provenance, so that a dry run reports what --apply does."""
    rows = await client.query(
        f"MATCH (n:Norma) WHERE n.provenance = 'community_validated' AND {_NOT_STUB_WHERE} "
        "RETURN id(n) AS id, coalesce(n.URN, n.node_id) AS key"
    )
    by_value: dict[str, list[int]] = {}
    for row in rows:
        value = Provenance.SEED.value if row["key"] in seed_keys else Provenance.INGESTION.value
        by_value.setdefault(value, []).append(row["id"])
    if apply:
        for value, ids in by_value.items():
            for chunk in _chunks(ids, batch):
                await client.query(
                    "UNWIND $ids AS i MATCH (n) WHERE id(n) = i SET n.provenance = $p, n.trust = NULL",
                    {"ids": chunk, "p": value},
                )
    return {value: len(ids) for value, ids in by_value.items()}


def plan_estremi(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The articles whose estremi the formatter writes differently. Only codes
    the URN table knows: for any other act the stored estremi ("Art. 11 L.
    154/1992") says more than the URN can."""
    changes = []
    for row in rows:
        urn = row.get("urn")
        if not urn or act_name_from_urn(urn) is None:
            continue
        _, estremi = estremi_from_urn(urn)
        if estremi and estremi != row.get("estremi"):
            changes.append({"id": row["id"], "estremi": estremi})
    return changes


async def rewrite_estremi(client, apply: bool, batch: int) -> int:
    rows = await client.query(
        "MATCH (n:Norma) WHERE n.numero_articolo IS NOT NULL OR n.is_stub = true "
        "RETURN id(n) AS id, n.URN AS urn, n.estremi AS estremi"
    )
    changes = plan_estremi(rows)
    if apply:
        for chunk in _chunks(changes, batch):
            await client.query("UNWIND $rows AS row MATCH (n) WHERE id(n) = row.id SET n.estremi = row.estremi", {"rows": chunk})
    return len(changes)


# Every label the writer before Task 4 could give a community entity: `tipo.capitalize()`.
# A fixed set from the code; a label name is never read from a node.
LEGACY_ENTITY_LABELS: tuple[str, ...] = tuple(sorted({t.value.capitalize() for t in EntityType}))

# Provenance values written before this round, and the schema value each one means.
LEGACY_PROVENANCE: dict[str, Provenance] = {"lazy_ingest": Provenance.INGESTION}


async def drop_legacy_entity_labels(client, apply: bool) -> dict[str, int]:
    """A community entity loses the `tipo.capitalize()` label the old writer gave it,
    unless that is the schema label of its kind (`Sanzione`, `Caso`, `Dottrina`...).
    Runs before every step that matches `Norma`: a community `norma` entity written
    `:Entity:Norma` is no norm."""
    report: dict[str, int] = {}
    for row in await client.query("MATCH (e:Entity) WHERE e.tipo IS NOT NULL RETURN DISTINCT e.tipo AS tipo"):
        tipo = row["tipo"]
        if not isinstance(tipo, str):
            continue
        keep = entity_label(tipo)
        for legacy in LEGACY_ENTITY_LABELS:
            if keep is not None and legacy == keep.value:
                continue
            match = f"MATCH (e:Entity:`{legacy}`) WHERE e.tipo = $tipo"
            count = await _count(client, f"{match} RETURN count(e) AS n", {"tipo": tipo})
            if not count:
                continue
            report[legacy] = report.get(legacy, 0) + count
            if apply:
                await client.query(f"{match} REMOVE e:`{legacy}`", {"tipo": tipo})
    return report


async def remap_provenance(client, apply: bool) -> dict[str, dict[str, int]]:
    """A provenance written before this round becomes the schema value it means
    (`LEGACY_PROVENANCE`); any other value outside `Provenance` is reported, unchanged."""
    known = {p.value for p in Provenance}
    report: dict[str, dict[str, int]] = {"remapped": {}, "unknown": {}}
    for row in await client.query("MATCH (n) WHERE n.provenance IS NOT NULL RETURN DISTINCT n.provenance AS p"):
        value = row["p"]
        if value in known:
            continue
        count = await _count(client, "MATCH (n) WHERE n.provenance = $p RETURN count(n) AS n", {"p": value})
        if value in LEGACY_PROVENANCE:
            report["remapped"][value] = count
            if apply:
                await client.query(
                    "MATCH (n) WHERE n.provenance = $p SET n.provenance = $new",
                    {"p": value, "new": LEGACY_PROVENANCE[value].value},
                )
        else:
            report["unknown"][str(value)] = count
    return report


async def stamp_provenance(client, apply: bool, batch: int, seed_keys: set[str]) -> dict[str, int]:
    """`seed` for what the Libro IV seed brought, `ingestion` for the rest. A community
    entity is never stamped here, whatever label it carries: its provenance is its own."""
    report: dict[str, int] = {}
    for label in PROVENANCE_LABELS:
        rows = await client.query(
            f"MATCH (n:{label.value}) WHERE n.provenance IS NULL AND NOT n:Entity "
            "RETURN id(n) AS id, coalesce(n.URN, n.node_id) AS key"
        )
        by_value: dict[str, list[int]] = {}
        for row in rows:
            value = Provenance.SEED.value if row["key"] in seed_keys else Provenance.INGESTION.value
            by_value.setdefault(value, []).append(row["id"])
        for value, ids in by_value.items():
            report[value] = report.get(value, 0) + len(ids)
            if apply:
                for chunk in _chunks(ids, batch):
                    await client.query("UNWIND $ids AS i MATCH (n) WHERE id(n) = i SET n.provenance = $p", {"ids": chunk, "p": value})
    return report


async def normalize_fonti(client, apply: bool) -> dict[str, int]:
    report: dict[str, int] = {}
    for pattern in ("(n)", "()-[n]->()"):
        rows = await client.query(f"MATCH {pattern} WHERE n.fonte IS NOT NULL RETURN DISTINCT n.fonte AS fonte")
        for row in rows:
            old = row["fonte"]
            new = normalize_fonte(old) if isinstance(old, str) else old
            if new == old:
                continue
            report[old] = report.get(old, 0) + await _count(
                client, f"MATCH {pattern} WHERE n.fonte = $old RETURN count(n) AS n", {"old": old}
            )
            if apply:
                await client.query(f"MATCH {pattern} WHERE n.fonte = $old SET n.fonte = $new", {"old": old, "new": new})
    return report


async def copy_text(client, apply: bool, batch: int) -> int:
    """`testo` on every article (spec §4.1); a live source's `text` moves to `testo`."""
    total = 0
    for where, assign in (
        ("MATCH (n:Norma) WHERE n.testo IS NULL AND n.testo_vigente IS NOT NULL", "SET n.testo = n.testo_vigente"),
        ("MATCH (n:LiveSource) WHERE n.testo IS NULL AND n.text IS NOT NULL", "SET n.testo = n.text, n.text = NULL"),
    ):
        count = await _count(client, f"{where} RETURN count(n) AS n")
        total += count
        while apply and count:
            if not await _count(client, f"{where} WITH n LIMIT {batch} {assign} RETURN count(n) AS n"):
                break
    return total


async def drop_stale_text(client, apply: bool) -> int:
    """A live source the provisional writer refreshed after Task 4 has `testo` and still
    its old `text`. `node_text` reads `testo` first, so the old one is never read, only
    stale: it goes."""
    match = "MATCH (n:LiveSource) WHERE n.testo IS NOT NULL AND n.text IS NOT NULL"
    count = await _count(client, f"{match} RETURN count(n) AS n")
    if apply and count:
        await client.query(f"{match} SET n.text = NULL")
    return count


async def stamp_fingerprints(client, apply: bool, batch: int) -> int:
    rows = await client.query(
        "MATCH (n:Norma) WHERE n.testo_sha256 IS NULL AND coalesce(n.testo, n.testo_vigente) IS NOT NULL "
        "RETURN id(n) AS id, coalesce(n.testo, n.testo_vigente) AS testo"
    )
    if apply:
        values = [{"id": row["id"], "sha": text_fingerprint(row["testo"])} for row in rows]
        for chunk in _chunks(values, batch):
            await client.query("UNWIND $rows AS row MATCH (n) WHERE id(n) = row.id SET n.testo_sha256 = row.sha", {"rows": chunk})
    return len(rows)


async def label_entities(client, apply: bool) -> dict[str, int]:
    """Community entities written before Task 4 (`:Entity:Concetto`, from
    `tipo.capitalize()`) gain the schema label of their kind, as a new one gets it
    (`entity_label`, `schema.ENTITY_LABEL_BY_TYPE`). The label is the map's, never the
    node's: `tipo` only picks the entry, and a type the map does not name gets none.
    The old label is removed first, by `drop_legacy_entity_labels`."""
    report: dict[str, int] = {}
    for row in await client.query("MATCH (e:Entity) WHERE e.tipo IS NOT NULL RETURN DISTINCT e.tipo AS tipo"):
        label = entity_label(row["tipo"]) if isinstance(row["tipo"], str) else None
        if label is None:
            continue
        match = f"MATCH (e:Entity) WHERE e.tipo = $tipo AND NOT e:{label.value}"
        count = await _count(client, f"{match} RETURN count(e) AS n", {"tipo": row["tipo"]})
        if not count:
            continue
        report[label.value] = report.get(label.value, 0) + count
        if apply:
            await client.query(f"{match} SET e:{label.value}", {"tipo": row["tipo"]})
    return report


async def key_entities(client, apply: bool) -> int:
    """Every community entity carries `node_id` next to its `id`, the same value, so
    the readers that return a node's key, `coalesce(URN, node_id)`, name it. An adopted
    seed twin keeps the seed's `node_id`."""
    match = "MATCH (e:Entity) WHERE e.node_id IS NULL AND e.id IS NOT NULL"
    count = await _count(client, f"{match} RETURN count(e) AS n")
    if apply and count:
        await client.query(f"{match} SET e.node_id = coalesce(e.node_id, e.id)")
    return count


async def report_twins(client) -> dict[str, list]:
    """Community entities that have a seed twin, and seed concepts that are twins of
    each other. Reported, never merged here: the entity writer merges new ones (Task 4);
    an existing pair needs a decision.

    The seed key comes from the name by the writer's rule (`seed_twin_slugs`: as spelt,
    then without a leading article), never from the community id, which drops accents
    and hyphens. It is looked up both ways: a seed name may keep an article the proposal
    drops ("La convalida"), so each seed name is indexed under both its keys too. Seed
    nodes whose names give one community id ("La reticenza", "reticenza") are
    near-duplicates: the writer adopts only the first it meets."""
    index: dict[Label, dict[str, list[str]]] = {}
    near: list[list[str]] = []
    for label in dict.fromkeys(label for label, _ in SEED_TWIN.values()):
        by_slug: dict[str, list[str]] = {}
        by_community_id: dict[str, list[str]] = {}
        rows = await client.query(
            f"MATCH (c:{label.value}) WHERE NOT c:Entity AND c.node_id IS NOT NULL AND c.nome IS NOT NULL "
            "RETURN c.node_id AS nid, c.nome AS nome"
        )
        for row in rows:
            for slug in seed_twin_slugs(row["nome"]):
                by_slug.setdefault(slug, []).append(row["nid"])
            by_community_id.setdefault(normalize_entity_name(row["nome"]), []).append(row["nid"])
        index[label] = by_slug
        near += [sorted(nids) for nids in by_community_id.values() if len(nids) > 1]
    twins = []
    for row in await client.query(
        "MATCH (e:Entity) WHERE e.id IS NOT NULL AND e.nome IS NOT NULL RETURN e.id AS id, e.tipo AS tipo, e.nome AS nome"
    ):
        twin = SEED_TWIN.get(row.get("tipo") or "")
        if not twin:
            continue
        for slug in seed_twin_slugs(row["nome"]):
            seeds = index[twin[0]].get(slug)
            if seeds:
                twins.append({"id": row["id"], "seed": sorted(seeds)})
                break
    return {"community": sorted(twins, key=lambda t: t["id"]), "seed_near_duplicates": sorted(near)}


async def migrate_graph(client, *, apply: bool, batch: int = 500, seed_keys: set[str]) -> dict[str, Any]:
    # Keys first (the steps after them read URN and node_id), then shapes and stamps,
    # then the community entities, whose provenance is their own, then the report.
    return {
        "relations": await rename_relations(client, apply, batch),
        "legacy_entity_labels": await drop_legacy_entity_labels(client, apply),
        "bare_keys": await wrap_bare_keys(client, apply),
        "versions": await rekey_versions(client, apply),
        "stubs": await unify_stubs(client, apply),
        "provenance_reset": await reset_entity_writer_stamps(client, apply, batch, seed_keys),
        "estremi": await rewrite_estremi(client, apply, batch),
        "provenance_legacy": await remap_provenance(client, apply),
        "provenance": await stamp_provenance(client, apply, batch, seed_keys),
        "fonte": await normalize_fonti(client, apply),
        "testo": await copy_text(client, apply, batch),
        "stale_text": await drop_stale_text(client, apply),
        "fingerprint": await stamp_fingerprints(client, apply, batch),
        "entity_labels": await label_entities(client, apply),
        "entity_node_id": await key_entities(client, apply),
        "twins": await report_twins(client),
    }


def plan_qdrant(points: list[tuple[Any, dict]]) -> dict[str, Any]:
    """What the vector migration changes, from (id, payload) pairs. Pure."""
    existing = {pid for pid, _ in points if not isinstance(pid, int)}
    rekey, drop, urn_fixes = [], [], []
    retype: dict[str, int] = {}
    for pid, payload in points:
        source_type = payload.get("source_type") or ""
        if source_type in LEGACY_SOURCE_TYPE:
            retype[source_type] = retype.get(source_type, 0) + 1
            source_type = LEGACY_SOURCE_TYPE[source_type].value
        urn = payload.get("article_urn") or ""
        canonical = canonical_urn(urn) or ""
        if isinstance(pid, int):  # keyed by Python's per-process hash(): lazy ingestion before this round
            key = payload.get("massima_index", 0) if source_type == "massima" else 0
            new_id = point_id(canonical, source_type, key)
            if new_id in existing:
                drop.append(pid)
            else:
                existing.add(new_id)
                rekey.append((pid, new_id, {**payload, "source_type": source_type, "article_urn": canonical}))
        elif canonical != urn:
            urn_fixes.append((pid, canonical))
    return {"rekey": rekey, "drop": drop, "urn_fixes": urn_fixes, "retype": retype}


def migrate_qdrant(client, collection: str, *, apply: bool, batch: int = 256) -> dict[str, Any]:
    """Re-key the lazy points to the schema's ids. Until this runs with --apply,
    `POST /api/v1/graph/search` answers empty: since A it skips the points keyed by
    an integer, which are the lazy ones."""
    from qdrant_client import models

    points, offset = [], None
    while True:
        page, offset = client.scroll(collection_name=collection, limit=batch, offset=offset, with_payload=True, with_vectors=False)
        points.extend((p.id, p.payload or {}) for p in page)
        if offset is None:
            break
    plan = plan_qdrant(points)
    if apply:
        for chunk in _chunks(plan["rekey"], batch):
            vectors = {p.id: p.vector for p in client.retrieve(collection_name=collection, ids=[old for old, _, _ in chunk], with_vectors=True)}
            client.upsert(collection_name=collection, points=[
                models.PointStruct(id=new, vector=vectors[old], payload=payload)
                for old, new, payload in chunk if old in vectors
            ])
            client.delete(collection_name=collection, points_selector=models.PointIdsList(points=[old for old, _, _ in chunk]))
        for chunk in _chunks(plan["drop"], batch):
            client.delete(collection_name=collection, points_selector=models.PointIdsList(points=chunk))
        for old in plan["retype"]:
            client.set_payload(
                collection_name=collection,
                payload={"source_type": LEGACY_SOURCE_TYPE[old].value},
                points=models.Filter(must=[models.FieldCondition(key="source_type", match=models.MatchValue(value=old))]),
            )
        for pid, urn in plan["urn_fixes"]:
            client.set_payload(collection_name=collection, payload={"article_urn": urn}, points=[pid])
    return {
        "rekeyed": len(plan["rekey"]),
        "duplicates_dropped": len(plan["drop"]),
        "retyped": plan["retype"],
        "urns_canonicalized": len(plan["urn_fixes"]),
    }


def load_seed_keys(path: Path) -> set[str]:
    graph = json.loads(path.read_text(encoding="utf-8"))
    keys = set()
    for node in graph["nodes"]:
        props = node.get("properties") or {}
        key = props.get("URN") or props.get("node_id")
        if key:
            keys.add(key)
    return keys


def _qdrant_client():
    from qdrant_client import QdrantClient

    url = os.getenv("QDRANT_URL")
    if url:
        return QdrantClient(url=url)
    return QdrantClient(host=os.getenv("QDRANT_HOST", "localhost"), port=int(os.getenv("QDRANT_PORT", "6333")))


async def _run(apply: bool, batch: int) -> dict[str, Any]:
    from merlt.scripts.load_seed_libro_iv import SEED_GRAPH_JSON
    from merlt.storage.vectors.collection import default_chunks_collection

    if not SEED_GRAPH_JSON.exists():
        raise SystemExit(f"{SEED_GRAPH_JSON} is missing: provenance cannot tell the seed from ingestion")
    client = FalkorDBClient()
    await client.connect()
    try:
        graph_report = await migrate_graph(client, apply=apply, batch=batch, seed_keys=load_seed_keys(SEED_GRAPH_JSON))
    finally:
        await client.close()
    vectors_report = migrate_qdrant(_qdrant_client(), default_chunks_collection(), apply=apply)
    return {"applied": apply, "graph": graph_report, "vectors": vectors_report}


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate the MERL-T graph and its vectors to the schema's vocabulary.")
    parser.add_argument("--apply", action="store_true", help="write the changes (default: report only)")
    parser.add_argument("--batch", type=int, default=500)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(_run(args.apply, args.batch)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
```

(FalkorDB's `SET n:Label`, `properties(r)`, `WHERE a:Label`, the id seek and `SET x = NULL` were checked on the development FalkorDB, in a scratch graph deleted afterwards, on 30 September. Not checked yet, and written to be checked on the throwaway FalkorDB of Step 2, where the integration tests run them: the `MERGE … ON CREATE SET nr = properties(r) … DELETE r` rename, `NOT (v)-[:VERSIONE_DI]->()`, `STARTS WITH`, and `SET e:<Label>` with `NOT e:<Label>`. A statement FalkorDB refuses is rewritten there to what it accepts, and the change is noted in this paragraph. One case no test covers: two legacy edges of one type between the same two nodes in one batch. Check it by hand on the throwaway FalkorDB: the second must meet the edge the first merged, so that one edge is left.)

`storage/graph/entity_writer.py`, in `_create_new_entity_node`: the `CREATE` gains `node_id: $id,` after `id: $id,`, and the docstring's property list says why — the readers name a node by `coalesce(URN, node_id)`, and an entity with `id` alone had no key for them. A seed twin the writer adopts keeps the seed's `node_id` (`_check_duplicate_mechanical` does not touch it).

`api/graph_router.py`, in `get_article_entities`: `COALESCE(e.node_id, e.URN, id(e)) as entity_id` becomes `COALESCE(e.URN, e.node_id) as entity_id` — a node's key, never FalkorDB's internal id, which changes when a node is deleted and recreated. `get_article_relations` already reads `COALESCE(target.URN, target.node_id)` and needs only the data.

Add `ROOT / "scripts" / "migrate_graph_vocabulary.py"` to the contract test's `EXEMPT`.

- [ ] **Step 4: Run the tests to verify they pass; stop the throwaway FalkorDB**

Run the commands of Step 2 again, then `tests/unit tests/pipeline tests/rlcf tests/scripts` whole (the contract test among them) and, with a disposable Postgres, `tests/api` (`services/merlt/CLAUDE.md`, "Tests"). Expected: PASS. Then `docker stop vx-mig-falkor`.

- [ ] **Step 5: Commit**

```bash
git add services/merlt/merlt/scripts/migrate_graph_vocabulary.py services/merlt/merlt/storage/graph/entity_writer.py services/merlt/merlt/api/graph_router.py services/merlt/tests
git commit -m "feat(merlt): migrate the graph and its vectors to the one vocabulary"
```

The implementer's part ends here. Task 6b follows; Step 6 is the controller's and comes last.

- [ ] **Step 6 (controller, last): migrate the development graph**

Not the implementer's: it rewrites the development graph, reversible only through the backup. It runs after Task 6b (whose indexes, integrity checks and retrieval gate it uses) and after the whole-branch review of pull request B.

The two scripts are in B's code, not in the images built from `develop`. Run them from the main checkout, which holds `services/merlt/data` (the seed keys come from it; worktrees lack it) and `infra/.env`, with B's package mounted over the image's; after step b the main checkout's `develop` holds B, and the mount can point at it.

```bash
B=<checkout holding pull request B's code>
run() { docker compose -f infra/compose.yml --profile merlt run --rm --no-deps -v "$B/services/merlt/merlt:/app/merlt:ro" merlt-worker python -m "$@"; }
```

a. **After B's whole-branch review**, with pull request B open and its CI green:

```bash
scripts/backup.sh
run merlt.scripts.retrieval_gate                  # before
run merlt.scripts.migrate_graph_vocabulary        # dry run
```

Read the dry-run report before going on: every number must be explainable. `graph.relations_collapsed` counts, per canonical type, the pairs of nodes where the rename leaves one edge for several (two legacy edges, or a legacy and a canonical one, between the same two nodes): the `MERGE` keeps the first edge's properties only. If it is not empty, decide before `--apply` whether the lost properties matter; the script never merges them. `graph.stubs.removed` names the properties the stub shape drops: check that none of them is content. Record in pull request B the backup folder, the dry-run report, the first gate and the label and relation counts before (`MATCH (n) RETURN labels(n)[0], count(*)`, `MATCH ()-[r]->() RETURN type(r), count(*)`).

b. **Merge A and B back to back:** mark capazme/VisuaLexAPI#39 ready, merge it with `merge: refactor/merlt-graph-vocabulary — one vocabulary for the graph's writers and readers`, then merge B with `merge: feat/merlt-graph-migration — the graph and its vectors move to the one vocabulary`.

c. **At once**, with the MERL-T containers stopped: between the merge and the rebuild, the running images carry the code from before A, which writes the old relation names and integer Qdrant ids. Stop them, apply, rebuild, start, and apply once more as a check:

```bash
docker compose -f infra/compose.yml --profile merlt stop merlt-api merlt-worker
run merlt.scripts.migrate_graph_vocabulary --apply
docker compose -f infra/compose.yml --profile merlt build merlt-api merlt-worker
docker compose -f infra/compose.yml --profile merlt up -d --force-recreate merlt-api merlt-worker
run merlt.scripts.migrate_graph_vocabulary --apply     # the check
```

The check changes nothing: every count is 0 and every map empty. What is reported, not fixed, stays as it was: `twins`, `bare_keys.reported`, `versions.reported`, `stubs.reported`, `vectors.unkeyed`, and the `integrity` numbers (Task 6b); the pull request explains them. From the merge until the containers stop, `POST /api/v1/graph/search` answers empty on A's code (see the paragraph at the top of this task); `run` uses `--no-deps`, so the stopped containers stay stopped while the script runs.

d. **Then the gate again:**

```bash
run merlt.scripts.retrieval_gate                  # after
```

**Retrieval gate:** no metric of the second `retrieval_gate` run is more than 0.02 below the first; a larger drop stops the round until it is explained. Record in pull request B, as a comment, the `--apply` report, the check's report, the second gate and the label and relation counts after.

---

### Task 6b: Indexes, integrity checks and the retrieval gate

Spec 4.4 and 9 (amended 1 October). Implement this task after Task 6's Step 5 (its commit). Its code lands **before Task 6's Step 6**, which the controller runs last, after the whole-branch review of pull request B: that run creates the indexes, reports the integrity checks, and runs the retrieval gate before and after `--apply`.

**Files:**
- Modify: `services/merlt/merlt/scripts/migrate_graph_vocabulary.py` (`ensure_graph_indexes`, `INTEGRITY_CHECKS`, `integrity_report`, `ensure_payload_indexes`; `_run`)
- Create: `services/merlt/merlt/scripts/retrieval_gate.py`
- Test: `services/merlt/tests/scripts/test_migrate_graph_indexes.py` (unit), `services/merlt/tests/scripts/test_migrate_graph_indexes_integration.py` (`integration`: throwaway FalkorDB), `services/merlt/tests/scripts/test_retrieval_gate.py` (unit)

**Interfaces:**
- Consumes: `GRAPH_INDEXES`, `QDRANT_PAYLOAD_INDEXES`, `canonical_urn` (Tasks 1, 1b); `distinct_in_order`, `compute_retrieval_metrics`, `compute_graded_relevance_metrics` (Task 5c); `create_semantic_gold_standard`, `RAGBenchmark`, `LegalKnowledgeGraph`.
- Produces: `async ensure_graph_indexes(client, apply) -> int` (indexes missing before the call); `async integrity_report(client) -> dict[str, int]`; `ensure_payload_indexes(client, collection, apply) -> list[str]`; the script's JSON gains `"indexes": {"graph", "vectors"}` and `"integrity"` next to `"graph"` and `"vectors"` — `migrate_graph`'s own report is unchanged, so Task 6's tests stand. `python -m merlt.scripts.retrieval_gate` prints `{"queries", "recall_at_5", "mrr", "hit_rate_at_5", "ndcg_at_10"}`; `summarize(retrieved, relevant, graded) -> dict`.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/scripts/test_migrate_graph_indexes.py
"""Qdrant payload indexes are created once."""
from unittest.mock import MagicMock

from merlt.scripts import migrate_graph_vocabulary as mig


def test_payload_indexes_are_created_only_when_missing():
    client = MagicMock()
    client.get_collection.return_value.payload_schema = {"article_urn": object()}
    assert mig.ensure_payload_indexes(client, "chunks", apply=True) == ["source_type"]
    client.create_payload_index.assert_called_once()
    assert client.create_payload_index.call_args.kwargs["field_name"] == "source_type"


def test_a_dry_run_creates_no_payload_index():
    client = MagicMock()
    client.get_collection.return_value.payload_schema = {}
    assert mig.ensure_payload_indexes(client, "chunks", apply=False) == ["article_urn", "source_type"]
    client.create_payload_index.assert_not_called()
```

```python
# services/merlt/tests/scripts/test_migrate_graph_indexes_integration.py
"""Indexes and integrity checks against a throwaway FalkorDB (see Task 6, Step 2), in a
graph of their own (`merlt_test_indexes`). The client reads FALKORDB_HOST and FALKORDB_PORT."""
import pytest
import pytest_asyncio

from merlt.scripts import migrate_graph_vocabulary as mig
from merlt.storage.graph import FalkorDBClient
from merlt.storage.graph.schema import GRAPH_INDEXES

pytestmark = pytest.mark.integration

BROKEN = """
CREATE (a:Norma {URN: 'x'}), (b:Norma {URN: 'x'}),
       (c:Norma {URN: 'y', tipo_documento: 'articolo'}),
       (d:Norma {estremi: 'senza chiave'}),
       (a)-[:RINVIA {certezza: 2.0}]->(b)
"""


@pytest_asyncio.fixture
async def graph():
    client = FalkorDBClient(graph_name="merlt_test_indexes")
    await client.connect()
    await client.query("MATCH (n) DETACH DELETE n")
    yield client
    try:
        await client.query("MATCH (n) DETACH DELETE n")
    finally:
        await client.close()


async def test_indexes_are_created_once(graph):
    await mig.ensure_graph_indexes(graph, apply=True)
    assert await mig.ensure_graph_indexes(graph, apply=True) == 0
    rows = await graph.query("CALL db.indexes() YIELD label, properties RETURN label, properties")
    present = {(row["label"], prop) for row in rows for prop in row["properties"]}
    assert {(label.value, prop) for label, prop in GRAPH_INDEXES} <= present


async def test_integrity_counts_what_is_wrong(graph):
    await graph.query(BROKEN)
    assert await mig.integrity_report(graph) == {
        "duplicate_urn": 1,
        "norma_without_urn": 1,
        "article_without_text": 1,
        "isolated_nodes": 2,
        "certezza_out_of_range": 1,
    }
```

```python
# services/merlt/tests/scripts/test_retrieval_gate.py
"""The gate scores articles in their canonical form."""
import pytest

from merlt.scripts.retrieval_gate import summarize

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453"


def test_a_versioned_urn_and_its_repetition_are_one_article():
    summary = summarize([[CC + "!vig=2020-01-01", CC]], [[CC]], [{CC: 3}])
    assert summary == {
        "queries": 1, "recall_at_5": pytest.approx(1.0), "mrr": pytest.approx(1.0),
        "hit_rate_at_5": pytest.approx(1.0), "ndcg_at_10": pytest.approx(1.0),
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

The unit tests with the first command of Task 6, Step 2 (with this task's test paths); the integration test against a throwaway FalkorDB started again as there (`vx-mig-falkor`, port 6399, reached through `FALKORDB_HOST=host.docker.internal FALKORDB_PORT=6399`; Task 6's Step 4 stopped it). CI runs it in its integration step.
Expected: FAIL — `module 'merlt.scripts.migrate_graph_vocabulary' has no attribute 'ensure_payload_indexes'`; `No module named 'merlt.scripts.retrieval_gate'`.

- [ ] **Step 3: Implement**

In `migrate_graph_vocabulary.py` (import `GRAPH_INDEXES`, `QDRANT_PAYLOAD_INDEXES` with the other schema names):

```python
async def ensure_graph_indexes(client, apply: bool) -> int:
    """Create the schema's FalkorDB indexes that are missing. FalkorDB refuses
    to index an attribute twice, so the existing indexes are listed first."""
    rows = await client.query("CALL db.indexes() YIELD label, properties RETURN label, properties")
    present = {(row["label"], prop) for row in rows for prop in (row["properties"] or [])}
    missing = [(label.value, prop) for label, prop in GRAPH_INDEXES if (label.value, prop) not in present]
    if apply:
        for label, prop in missing:
            await client.query(f"CREATE INDEX FOR (n:{label}) ON (n.{prop})")
    return len(missing)


# Reported, never fixed: the numbers go into the pull request (spec 4.4).
INTEGRITY_CHECKS: dict[str, str] = {
    "duplicate_urn": "MATCH (n:Norma) WHERE n.URN IS NOT NULL WITH n.URN AS urn, count(*) AS c WHERE c > 1 RETURN count(urn) AS n",
    "norma_without_urn": "MATCH (n:Norma) WHERE n.URN IS NULL RETURN count(n) AS n",
    "article_without_text": (
        "MATCH (n:Norma {tipo_documento: 'articolo'}) WHERE coalesce(n.is_stub, false) = false "
        "AND n.testo IS NULL AND n.testo_vigente IS NULL RETURN count(n) AS n"
    ),
    "isolated_nodes": "MATCH (n) WHERE NOT (n)--() RETURN count(n) AS n",
    "certezza_out_of_range": (
        "MATCH ()-[r]->() WHERE r.certezza IS NOT NULL AND (r.certezza < 0 OR r.certezza > 1) RETURN count(r) AS n"
    ),
}


async def integrity_report(client) -> dict[str, int]:
    return {name: await _count(client, cypher) for name, cypher in INTEGRITY_CHECKS.items()}


def ensure_payload_indexes(client, collection: str, apply: bool) -> list[str]:
    from qdrant_client import models

    present = set((client.get_collection(collection).payload_schema or {}).keys())
    missing = [field for field in QDRANT_PAYLOAD_INDEXES if field not in present]
    if apply:
        for field in missing:
            client.create_payload_index(
                collection_name=collection, field_name=field, field_schema=models.PayloadSchemaType.KEYWORD,
            )
    return missing
```

`_run` creates the graph indexes first (the migration's `MERGE`s and `MATCH`es use them), migrates, then reports integrity:

```python
    try:
        indexes_graph = await ensure_graph_indexes(client, apply)
        graph_report = await migrate_graph(client, apply=apply, batch=batch, seed_keys=load_seed_keys(SEED_GRAPH_JSON))
        integrity = await integrity_report(client)
    finally:
        await client.close()
    qdrant = _qdrant_client()
    collection = default_chunks_collection()
    indexes_vectors = ensure_payload_indexes(qdrant, collection, apply)
    vectors_report = migrate_qdrant(qdrant, collection, apply=apply)
    return {
        "applied": apply, "graph": graph_report, "vectors": vectors_report,
        "indexes": {"graph": indexes_graph, "vectors": indexes_vectors}, "integrity": integrity,
    }
```

```python
# services/merlt/merlt/scripts/retrieval_gate.py
"""Retrieval before and after a change to the graph (spec section 9).

The semantic gold standard (Libro IV, 30 graded queries), every source type,
top 10, scored per article in canonical form. Read-only. Run it before and
after the migration and compare.

    python -m merlt.scripts.retrieval_gate
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from merlt.benchmark.metrics import compute_graded_relevance_metrics, compute_retrieval_metrics
from merlt.storage.graph.schema import canonical_urn

TOP_K = 10


def summarize(retrieved: list[list[str]], relevant: list[list[str]], graded: list[dict[str, int]]) -> dict[str, Any]:
    retrieved = [[canonical_urn(u) for u in urns] for urns in retrieved]
    plain = compute_retrieval_metrics(retrieved, relevant)
    scored = compute_graded_relevance_metrics(retrieved, graded)
    return {
        "queries": len(retrieved),
        "recall_at_5": plain.recall_at_5,
        "mrr": plain.mrr,
        "hit_rate_at_5": plain.hit_rate_at_5,
        "ndcg_at_10": scored.ndcg_at_10,
    }


async def run() -> dict[str, Any]:
    import dataclasses

    from merlt import LegalKnowledgeGraph
    from merlt.benchmark.gold_standard import create_semantic_gold_standard
    from merlt.benchmark.rag_benchmark import RAGBenchmark
    from merlt.scripts.migrate_graph_vocabulary import _qdrant_client
    from merlt.storage.vectors.collection import default_chunks_collection
    from merlt.worker.config import merlt_config_from_env

    # The collection the migration migrates. LegalKnowledgeGraph() alone would use its
    # hardcoded development defaults and, finding no collection, create an empty one:
    # the gate would read 0 before and after and pass, and write while saying it reads.
    collection = default_chunks_collection()
    qdrant = _qdrant_client()
    if not qdrant.collection_exists(collection_name=collection) or not qdrant.count(collection_name=collection).count:
        raise SystemExit(f"Qdrant collection {collection!r} is missing or empty: nothing to measure")
    gold = create_semantic_gold_standard()
    kg = LegalKnowledgeGraph(dataclasses.replace(merlt_config_from_env(), qdrant_collection=collection))
    await kg.connect()
    try:
        if kg._qdrant is None or kg._embedding_service is None:
            raise SystemExit("no Qdrant or no embedding model after connect: nothing to measure")
        bench = RAGBenchmark(kg, gold)
        retrieved = []
        for query in gold:
            hits = await bench._search_with_source_filter(query.text, "all", TOP_K)
            retrieved.append([hit["urn"] for hit in hits])
    finally:
        await kg.close()
    return summarize(retrieved, [q.relevant_urns for q in gold], [q.relevance_scores for q in gold])


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run()), indent=2))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the commands of Step 2. Expected: PASS. Then `docker stop vx-mig-falkor`. If FalkorDB rejects `CREATE INDEX FOR (n:L) ON (n.p)` or `CALL db.indexes()` yields other column names, fix the two statements to what the throwaway FalkorDB accepts and note it here, as Task 6 did for its statements.

- [ ] **Step 5: Commit**

```bash
git add services/merlt/merlt/scripts/migrate_graph_vocabulary.py services/merlt/merlt/scripts/retrieval_gate.py services/merlt/tests/scripts
git commit -m "feat(merlt): the migration creates the indexes, reports integrity and has a retrieval gate"
```

Pull request B's code is complete. Its whole-branch review follows; then the controller runs Task 6's Step 6.

---

### Task 7: "Complete?" instead of "exists?"

**Files:**
- Modify: `services/merlt/merlt/api/graph_router.py:50-111` (check-article)
- Modify: `apps/server/src/services/merlt/graphClient.ts:40-44` (`CheckArticleResponse`)
- Modify: `apps/server/src/services/merlt/lazyIngest.ts` (`ingestedRecently`)
- Modify: `apps/server/src/routes/merlt/events.ts:~121-139` (the lazy trigger)
- Modify: `services/merlt/merlt/core/legal_knowledge_graph.py` (`ingest_norm`'s embedding step; new `_seed_article_has_points`)
- Test: `services/merlt/tests/api/test_check_article_completeness.py` (new); `services/merlt/tests/pipeline/test_seed_article_vectors.py` (new); `apps/server/tests/integration/merlt/graph/lazy-trigger-completeness.test.ts` (new)

**Interfaces:**
- Consumes: `canonical_urn`, `ARTICLE_COMPLETENESS_PARTS`, `text_fingerprint`, `Provenance` (Task 1); `testo`, `testo_sha256`, `CONTIENE`, `provenance` in the graph (Tasks 3–6); `FalkorDBClient.ro_query` (pull request A).
- Produces: `GET /api/v1/graph/check-article` → `{exists, complete, missing: string[], node_id?, pending_validation?}` with `missing ⊆ ["node", "text", "commi", "hierarchy", "fingerprint"]`; `graph_router.article_missing_parts(row) -> list[str]`; `LegalKnowledgeGraph._seed_article_has_points(article_urn) -> bool`; BFF `ingestedRecently(prisma, urn): Promise<boolean>`.

Deploy after the migration has run (Task 6, Step 6): before it, no article has a fingerprint and every view would enqueue an ingestion.

From pull request A's review:

- **Only a `Norma` is a parent.** The hierarchy is the chain of partitions and acts, all `Norma` nodes; anything else that `CONTIENE` an article is not its place in the act.
- **The hash of empty text is no fingerprint.** The fingerprint is `testo_sha256`, the SHA-256 of `article_text` — never `akn_sha256`, the AKN fingerprint of `/fetch_act_fingerprints`. An article stored with empty text was fingerprinted all the same, and `sha256("")` proves nothing.
- **A seed article keeps its vectors (M5).** On first view the trigger re-ingests the 45 seed articles and 469 stubs this check finds incomplete. The seed loader keyed its points by their text, the lazy writer keys them by position: re-embedding a seed article would put a second set of points next to the first. The embedding step is skipped for a seed article that already has points; phase 2 re-keys both and drops the skip.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/api/test_check_article_completeness.py
"""check-article answers "complete?" (spec 2026-09-30, §4.3)."""
from unittest.mock import AsyncMock, MagicMock, patch

from merlt.api.graph_router import _CHECK_ARTICLE_CYPHER, check_article_in_graph
from merlt.storage.graph.schema import text_fingerprint

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1321"


def _client(rows):
    client = MagicMock()
    client.connect = AsyncMock()
    client.close = AsyncMock()
    client.query = AsyncMock(return_value=rows)
    return client


def _row(**parts):
    row = {"node_id": CC, "is_stub": False, "has_text": True, "commi": 3, "parents": 1, "has_fingerprint": True, "pending_validation": False}
    row.update(parts)
    return row


async def test_a_stub_misses_every_part():
    client = _client([_row(is_stub=True, has_text=False, commi=0, parents=0, has_fingerprint=False)])
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        body = await check_article_in_graph(article_urn=CC + "@originale", api_key=None)
    assert body["exists"] is True and body["complete"] is False
    assert body["missing"] == ["text", "commi", "hierarchy", "fingerprint"]
    assert client.query.await_args.args[1]["urn"] == CC  # the version marker never reaches the graph


async def test_a_mechanical_article_without_commi_is_incomplete():
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=_client([_row(commi=0, parents=0)])):
        body = await check_article_in_graph(article_urn=CC, api_key=None)
    assert body["missing"] == ["commi", "hierarchy"]


async def test_every_part_present_is_complete():
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=_client([_row()])):
        body = await check_article_in_graph(article_urn=CC, api_key=None)
    assert body["complete"] is True and body["missing"] == []


async def test_an_absent_article_misses_the_node():
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=_client([])):
        body = await check_article_in_graph(article_urn=CC, api_key=None)
    assert body == {"exists": False, "complete": False, "missing": ["node"]}


def test_commi_and_parents_are_counted_through_contiene():
    assert "-[:CONTIENE]->(c:Comma)" in _CHECK_ARTICLE_CYPHER
    assert "(parent:Norma)-[:CONTIENE]->(a)" in _CHECK_ARTICLE_CYPHER  # only a partition or an act


async def test_the_hash_of_empty_text_is_no_fingerprint():
    client = _client([_row()])
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        await check_article_in_graph(article_urn=CC, api_key=None)
    cypher, params = client.query.await_args.args
    assert params == {"urn": CC, "empty_sha": text_fingerprint("")}
    assert "coalesce(a.testo_sha256, $empty_sha) <> $empty_sha AS has_fingerprint" in cypher
```

```python
# services/merlt/tests/pipeline/test_seed_article_vectors.py
"""A seed article read in VisuaLex is completed in the graph; its vectors stay the seed's (M5)."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1321"


def _kg(provenance, points):
    kg = LegalKnowledgeGraph.__new__(LegalKnowledgeGraph)
    kg._falkordb = MagicMock(ro_query=AsyncMock(return_value=[{"p": provenance}] if provenance else []))
    kg._qdrant = MagicMock()
    kg._qdrant.count.return_value = SimpleNamespace(count=points)
    kg.config = MagicMock(qdrant_collection="chunks")
    return kg


async def test_a_seed_article_with_points_keeps_them():
    assert await _kg("seed", 3)._seed_article_has_points(CC) is True


async def test_a_seed_article_without_points_gets_them():
    assert await _kg("seed", 0)._seed_article_has_points(CC) is False


async def test_an_ingested_or_absent_article_is_embedded_and_qdrant_is_not_asked():
    for kg in (_kg("ingestion", 3), _kg(None, 3)):
        assert await kg._seed_article_has_points(CC) is False
        kg._qdrant.count.assert_not_called()


async def test_the_points_are_counted_by_the_canonical_urn():
    kg = _kg("seed", 1)
    await kg._seed_article_has_points(CC + "!vig=")
    assert kg._falkordb.ro_query.await_args.args[1] == {"urn": CC}
    condition = kg._qdrant.count.call_args.kwargs["count_filter"].must[0]
    assert (condition.key, condition.match.value) == ("article_urn", CC)
```

```ts
// apps/server/tests/integration/merlt/graph/lazy-trigger-completeness.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from '../../../helpers';
import {
  _resetMerltClientForTests,
  _resetEventsGraphClientForTests,
} from '../../../../src/routes/merlt/events';

/**
 * The lazy trigger asks MERL-T "is this article complete?" (spec 2026-09-30 §4.3):
 * a stub or a partial article is completed the first time someone reads it, and
 * an article that stays incomplete is not re-ingested on every view.
 */

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';
const BASE = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
  _resetMerltClientForTests();
  _resetEventsGraphClientForTests();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
  delete process.env.MERLT_API_URL;
  delete process.env.MERLT_TIMEOUT_MS;
});

function payload(articleUrn: string) {
  return { articleUrn, dwellMs: 4500, scrollMaxPct: 60, sessionId: '00000000-0000-0000-0000-000000000002' };
}

function mockTracking(): void {
  nock(TEST_MERLT_BASE).get('/api/v1/profile/full').query(true).reply(503);
  nock(TEST_MERLT_BASE).post('/api/v1/tracking/events').reply(200, { received: 1, timestamp: '2026-10-01T00:00:00Z' });
}

function mockCheck(urn: string, body: Record<string, unknown>): void {
  nock(TEST_MERLT_BASE)
    .get('/api/v1/graph/check-article')
    .query((q) => q.article_urn === urn)
    .reply(200, body);
}

describe('lazy trigger: complete, not only existing', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('complete-alice');
    await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'basic' });
  });

  it('enqueues an ingestion for an article that exists but is incomplete', async () => {
    const urn = `${BASE}1321`;
    mockTracking();
    mockCheck(urn, { exists: true, complete: false, missing: ['commi'], node_id: urn });
    const ingest = nock(TEST_MERLT_BASE)
      .post('/api/v1/graph/ingest-article', (body: { urn?: string }) => body.urn === urn)
      .reply(202, { task_id: 'ingest:complete1', status: 'queued', urn });

    const res = await request(app).post('/api/merlt/events/article-viewed').set(authHeader(user)).send(payload(urn));

    expect(res.status).toBe(202);
    expect(res.body.ingestionJob?.status).toBe('pending');
    expect(ingest.isDone()).toBe(true);
  });

  it('does nothing for a complete article', async () => {
    const urn = `${BASE}1322`;
    mockTracking();
    mockCheck(urn, { exists: true, complete: true, missing: [], node_id: urn });

    const res = await request(app).post('/api/merlt/events/article-viewed').set(authHeader(user)).send(payload(urn));

    expect(res.body.ingestionJob).toBeUndefined();
    expect(await prisma.merltIngestionJob.count({ where: { articleUrn: urn } })).toBe(0);
  });

  it('does not ask again for an article ingested in the last day that is still incomplete', async () => {
    const urn = `${BASE}1323`;
    await prisma.merltIngestionJob.create({
      data: { articleUrn: urn, userId: user.id, status: 'completed', completedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    mockTracking();
    mockCheck(urn, { exists: true, complete: false, missing: ['commi'], node_id: urn });

    const res = await request(app).post('/api/merlt/events/article-viewed').set(authHeader(user)).send(payload(urn));

    expect(res.body.ingestionJob).toBeUndefined();
    expect(await prisma.merltIngestionJob.count({ where: { articleUrn: urn } })).toBe(1);
  });

  it('reads an older MERL-T that only says "exists" as before', async () => {
    const urn = `${BASE}1324`;
    mockTracking();
    mockCheck(urn, { exists: true, node_id: urn });

    const res = await request(app).post('/api/merlt/events/article-viewed').set(authHeader(user)).send(payload(urn));

    expect(res.body.ingestionJob).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

MERL-T: `… -m pytest tests/api/test_check_article_completeness.py tests/pipeline/test_seed_article_vectors.py -q -p no:cacheprovider`. BFF: `npm --prefix apps/server test -- lazy-trigger-completeness` (its setup refuses a non-test database; `apps/server/CLAUDE.md`). Expected: FAIL.

- [ ] **Step 3: Implement**

`api/graph_router.py`:

```python
from merlt.storage.graph.schema import ARTICLE_COMPLETENESS_PARTS, canonical_urn, text_fingerprint

# Only a Norma (a partition or an act) is a parent. `testo_sha256` of empty text is
# no fingerprint: `$empty_sha` is `text_fingerprint("")`.
_CHECK_ARTICLE_CYPHER = """
MATCH (a:Norma)
WHERE a.URN = $urn OR a.node_id = $urn
OPTIONAL MATCH (a)-[:CONTIENE]->(c:Comma)
WITH a, count(c) AS commi
OPTIONAL MATCH (parent:Norma)-[:CONTIENE]->(a)
RETURN
    COALESCE(a.node_id, a.URN) AS node_id,
    coalesce(a.is_stub, false) AS is_stub,
    coalesce(a.testo, a.testo_vigente, '') <> '' AS has_text,
    commi,
    count(parent) AS parents,
    coalesce(a.testo_sha256, $empty_sha) <> $empty_sha AS has_fingerprint,
    false AS pending_validation
"""
_EMPTY_TEXT_SHA = text_fingerprint("")


def article_missing_parts(row: Dict[str, Any]) -> List[str]:
    """What an article in the graph still lacks (schema.ARTICLE_COMPLETENESS_PARTS)."""
    present = {
        "text": bool(row.get("has_text")),
        "commi": bool(row.get("commi")),
        "hierarchy": bool(row.get("parents")),
        "fingerprint": bool(row.get("has_fingerprint")),
    }
    return [part for part in ARTICLE_COMPLETENESS_PARTS if not present[part]]
```

In `check_article_in_graph`: the docstring says it answers "complete?" and lists the parts; it queries `_CHECK_ARTICLE_CYPHER` with `{"urn": canonical_urn(article_urn), "empty_sha": _EMPTY_TEXT_SHA}` and answers

```python
        if result:
            row = result[0]
            missing = article_missing_parts(row)
            log.info("Article found in graph", article_urn=article_urn, node_id=row["node_id"], missing=missing)
            return {
                "exists": True,
                "complete": not missing,
                "missing": missing,
                "node_id": row["node_id"],
                "pending_validation": row["pending_validation"],
            }
        log.info("Article not found in graph", article_urn=article_urn)
        return {"exists": False, "complete": False, "missing": ["node"]}
```

`core/legal_knowledge_graph.py` (import `Provenance` with the other schema names):

```python
    async def _seed_article_has_points(self, article_urn: str) -> bool:
        """A seed article whose vectors the seed loader wrote. They are keyed by their
        text, the lazy writer's by position: re-embedding the article would put a second
        set next to the first. Phase 2 re-keys both and drops this check."""
        urn = canonical_urn(article_urn)
        rows = await self._falkordb.ro_query(
            "MATCH (a:Norma {URN: $urn}) RETURN a.provenance AS p", {"urn": urn}
        )
        if not rows or rows[0].get("p") != Provenance.SEED.value:
            return False
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        hits = self._qdrant.count(
            collection_name=self.config.qdrant_collection,
            count_filter=Filter(must=[FieldCondition(key="article_urn", match=MatchValue(value=urn))]),
            exact=True,
        )
        return hits.count > 0
```

In `ingest_norm`, step 6 (embeddings), inside its `try`: when `await self._seed_article_has_points(ingestion_result.article_urn)`, log `"Seed article keeps its vectors"` with the URN and skip `_upsert_embeddings_multi_source`; otherwise call it as today. The graph part of the ingestion runs either way: that is what completes the article.

BFF `graphClient.ts`:

```ts
export interface CheckArticleResponse {
  exists: boolean;
  /** Every part an article needs is in the graph (spec 2026-09-30 §4.3). An
   *  older MERL-T without the field answers only `exists`. */
  complete?: boolean;
  missing?: string[];
  node_id?: string;
  pending_validation?: boolean;
}
```

`lazyIngest.ts`:

```ts
const RECENT_COMPLETION_MS = 24 * 60 * 60 * 1000;

/**
 * An ingestion of this article completed in the last day. The lazy trigger
 * then does not ask again: an article whose source lacks a part (no commi,
 * say) would otherwise be re-ingested on every view.
 */
export async function ingestedRecently(prisma: PrismaClient, urn: string): Promise<boolean> {
  const row = await prisma.merltIngestionJob.findFirst({
    where: {
      articleUrn: normalizeGraphUrn(urn),
      status: 'completed',
      completedAt: { gte: new Date(Date.now() - RECENT_COMPLETION_MS) },
    },
    select: { id: true },
  });
  return row !== null;
}
```

`events.ts`: the comment above the block says "not yet complete" instead of "not yet in the knowledge graph", and

```ts
    const check = await graphClient().checkArticle(parsed.data.articleUrn);
    const complete = check.complete ?? check.exists;
    if (!complete && !(await ingestedRecently(prisma, parsed.data.articleUrn))) {
```

(import `ingestedRecently` next to `ensureIngestionJob`).

- [ ] **Step 4: Run the tests to verify they pass**

Both commands of Step 2, then `npm --prefix apps/server test` (the whole BFF suite: the existing lazy-trigger tests stay green) and `npm --prefix apps/server run build`. Expected: PASS.

- [ ] **Step 5: Live check, commit and open pull request C**

With the migrated development graph and rebuilt MERL-T images: `curl "http://127.0.0.1:8000/api/v1/graph/check-article?article_urn=<a seed article URL>"` answers `complete: true`; on a stub it answers `missing: ["text","commi","hierarchy","fingerprint"]`; reading that stub's article in the browser enqueues one job, and after it completes the check answers `complete: true`. Reading a seed article the check finds incomplete enqueues one job too, and its Qdrant points (a `count` filtered on its `article_urn`) are as many after the job as before.

```bash
git add services/merlt/merlt/api/graph_router.py services/merlt/merlt/core/legal_knowledge_graph.py services/merlt/tests/api services/merlt/tests/pipeline/test_seed_article_vectors.py apps/server/src apps/server/tests
git commit -m "feat(merlt): an article read in VisuaLex is completed, not only created"
```

---

### Task 8: The graph is shown to validators only

**Files:**
- Modify: `apps/server/src/routes/merlt/graph.ts:80,211` (`GET /graph/article/:urn` and `POST /graph/ingest` get `requireAdmin`; `/graph/search` stays: contributors' entity picker uses it)
- Modify: `apps/web/src/features/merlt/useMerltFeatures.ts` (`graphReadable`)
- Modify: `apps/web/src/components/layout/Sidebar.tsx:~286`, `apps/web/src/features/merlt/graph/page/GraphExplorerPage.tsx:~176,1049`, `apps/web/src/plugins/registry.tsx:~33-38`, `apps/web/src/components/features/search/ArticleTabContent.tsx:~1045`, `apps/web/src/pages/MerltHubPage.tsx:~58-83`
- Create: `apps/web/src/features/merlt/graph/side-rail/GraphSideRailSlot.tsx`
- Modify: `apps/web/src/features/merlt/graph/shared/graphStyles.ts:62-80,171-196,392`, `graph/page/GraphFilterPanel.tsx:77`, `graph/page/EdgeDetailsDrawer.tsx:53`
- Modify: `docs/merlt/claude-notes.md` (the graph is admin-only; D2 "reading is free" no longer holds for the graph)
- Test: `apps/server/tests/integration/merlt/graph-routes.test.ts`; `apps/web/src/features/merlt/__tests__/useMerltFeatures.test.tsx`; `apps/web/src/features/merlt/graph/side-rail/__tests__/GraphSideRailSlot.test.tsx` (new); `apps/web/src/pages/__tests__/MerltHubPage.test.tsx`; `apps/web/src/features/merlt/graph/shared/__tests__/graphStyles.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (`apps/server/src/middleware/merlt/requireAdmin.ts`), `useAuth().isAdmin`.
- Produces: `useMerltFeatures().graphReadable === graphEnabled && isAdmin`; `edgeTypeStyle(type): EdgeTypeStyle | undefined` in `graphStyles.ts`.

- [ ] **Step 1: Write the failing tests**

BFF, in `graph-routes.test.ts`: add `async function makeAdmin(user: TestUser): Promise<void> { await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } }); }` and call it in the `beforeEach` of the `/graph/article/:urn` and `/graph/ingest` describes (their existing tests then pass as administrators). Add:

```ts
describe('the graph is for validators (spec 2026-09-30 §6.5)', () => {
  it('refuses the subgraph and the manual ingestion to a non-admin', async () => {
    const user = await createTestUser('graph-bob');
    await grantConsent(user, 'full');
    const urn = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043';

    const article = await request(app).get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`).set(authHeader(user));
    const ingest = await request(app).post('/api/merlt/graph/ingest').set(authHeader(user)).send({ urn });

    expect(article.status).toBe(403);
    expect(ingest.status).toBe(403);
  });

  it('keeps the entity search for contributors', async () => {
    const user = await createTestUser('graph-carol');
    await grantConsent(user, 'full');
    nock(TEST_MERLT_BASE).get('/api/v1/graph/entities/search').query(true).reply(200, []);

    const res = await request(app).get('/api/merlt/graph/search?q=colpa').set(authHeader(user));

    expect(res.status).toBe(200);
  });
});
```

Web, in `useMerltFeatures.test.tsx`: the tests that expect `graphReadable` true for a non-admin now expect `false`, and add

```tsx
  it('the graph is readable by administrators only', () => {
    useConsentMock.mockReturnValue({ level: 'full', canTrack: true, status: 'ready' });
    useAuthMock.mockReturnValue({ isAdmin: false });
    expect(renderHook(() => useMerltFeatures()).result.current.graphReadable).toBe(false);
    useAuthMock.mockReturnValue({ isAdmin: true });
    expect(renderHook(() => useMerltFeatures()).result.current.graphReadable).toBe(true);
  });
```

```tsx
// apps/web/src/features/merlt/graph/side-rail/__tests__/GraphSideRailSlot.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const features = vi.fn();
vi.mock('../../../useMerltFeatures', () => ({ useMerltFeatures: () => features() }));
vi.mock('../ArticleGraphSideRail', () => ({ ArticleGraphSideRail: () => <div data-testid="rail" /> }));

import { GraphSideRailSlot } from '../GraphSideRailSlot';

describe('GraphSideRailSlot', () => {
  it('renders nothing for a reader who does not validate', () => {
    features.mockReturnValue({ graphReadable: false });
    render(<GraphSideRailSlot articleUrn="urn:x" />);
    expect(screen.queryByTestId('rail')).toBeNull();
  });

  it('renders the rail for an administrator', () => {
    features.mockReturnValue({ graphReadable: true });
    render(<GraphSideRailSlot articleUrn="urn:x" />);
    expect(screen.getByTestId('rail')).toBeTruthy();
  });
});
```

In `MerltHubPage.test.tsx`: for a non-admin, `queryByTestId('hub-card-qa')` and `queryByTestId('hub-card-graph')` are null and the header does not contain "fai domande"; for an admin both cards render.

In the existing `graph/shared/__tests__/graphStyles.test.ts`, `toHaveProperty('abroga')` becomes `toHaveProperty('ABROGA')`, and it gains:

```ts
// apps/web/src/features/merlt/graph/shared/__tests__/graphStyles.test.ts
import { describe, it, expect } from 'vitest';
import { edgeTypeStyle, humanizeEdgeType } from '../graphStyles';

describe('edge styles read the schema names in any case', () => {
  it('styles and names upper-case relations', () => {
    expect(edgeTypeStyle('contiene')).toEqual(edgeTypeStyle('CONTIENE'));
    expect(edgeTypeStyle('RINVIA')).toBeDefined();
    expect(humanizeEdgeType('RINVIA')).toBe('Rinvia a');
    expect(humanizeEdgeType('interpreta')).toBe('Interpreta');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

`npm --prefix apps/server test -- graph-routes` and `npm --prefix apps/web run test -- --run useMerltFeatures GraphSideRailSlot MerltHubPage graphStyles`. Expected: FAIL.

- [ ] **Step 3: Implement**

BFF `routes/merlt/graph.ts`: `router.get('/graph/article/:urn', authenticate, requireAdmin, …)` and `router.post('/graph/ingest', authenticate, requireAdmin, consentGuard, …)`; import `requireAdmin` from `../../middleware/merlt/requireAdmin`. The lazy trigger in `events.ts` runs server-side and needs neither route.

`useMerltFeatures.ts`:

```ts
    // The graph is shown to those who validate (owner's decision, 30 September
    // 2026; spec 2026-09-30 §6.5): administrators today. It supersedes D2's
    // "reading is free" for the graph. The Q&A lives on /grafo and follows it.
    graphReadable: graphEnabled && isAdmin,
```

`GraphSideRailSlot.tsx`:

```tsx
import { useMerltFeatures } from '../../useMerltFeatures';
import { ArticleGraphSideRail, type ArticleGraphSideRailProps } from './ArticleGraphSideRail';

/** The side rail, only for those who may read the graph (spec 2026-09-30 §6.5). */
export function GraphSideRailSlot(props: ArticleGraphSideRailProps): React.ReactElement | null {
  const { graphReadable } = useMerltFeatures();
  if (!graphReadable) return null;
  return <ArticleGraphSideRail {...props} />;
}
```

`plugins/registry.tsx` registers `GraphSideRailSlot` instead of `ArticleGraphSideRail`.

`Sidebar.tsx`: the "Grafo" entry renders under `isMerltEnabled() && isMerltGraphEnabled() && isAdmin` (`isAdmin` from the component's existing `useAuth()`); update the comment above it.

`GraphExplorerPage.tsx`: `const { qaAskable, canContribute, graphReadable } = useMerltFeatures();` and `const enabled = graphReadable;` (drop the now-unused `isMerltGraphEnabled` import). A non-administrator sees the existing "Grafo non disponibile." state and nothing is fetched.

`ArticleTabContent.tsx`: take `graphReadable` from `useMerltFeatures()` and pass `merltEnabled={merltEnabled && graphReadable}` to `AskMerltEntry` (the entry and its consent teaser lead to `/grafo`).

`MerltHubPage.tsx`: `QaCard` and `GraphCard` render only when `features.graphReadable` (drop the D2 comment above `GraphCard`); the header's description keeps today's text for administrators and, for everyone else, reads `Il tuo centro per l’intelligenza giuridica MERL-T: valida le proposte della community e contribuisci con i tuoi appunti.`

`graphStyles.ts`: the tables are keyed by the schema's upper-case names and read case-insensitively:

```ts
export const EDGE_TYPE_STYLE: Record<string, EdgeTypeStyle> = {
  DISCIPLINA: { color: '#2563eb' },
  INTERPRETA: { color: '#7c3aed' },
  APPLICA_A: { color: '#0ea5e9' },
  CONTIENE: { color: '#94a3b8' },
  IMPONE: { color: '#dc2626' },
  COMMENTA: { color: '#d97706', dash: true },
  ESPRIME_PRINCIPIO: { color: '#a855f7' },
  ATTRIBUISCE_RESPONSABILITA: { color: '#db2777' },
  PREVEDE: { color: '#059669' },
  DEFINISCE: { color: '#8b5cf6' },
  STABILISCE_TERMINE: { color: '#64748b' },
  PREVEDE_SANZIONE: { color: '#ef4444' },
  MODIFICA: { color: '#f59e0b', dash: true },
  ABROGA: { color: '#b91c1c', dash: true },
  INSERISCE: { color: '#16a34a', dash: true },
  SOSTITUISCE: { color: '#ea580c', dash: true },
  RINVIA: { color: '#0891b2' },
  CORRELATO: { color: '#a1a1aa', dash: true },
  ESPRIME: { color: '#c026d3' },
  MENZIONA: { color: '#65a30d' },
  DERIVA_DA: { color: '#78716c', dash: true },
  VERSIONE_DI: { color: '#94a3b8', dash: true },
};

/** The style of a relation type, whichever case the graph used. */
export function edgeTypeStyle(type: string | undefined | null): EdgeTypeStyle | undefined {
  return type ? EDGE_TYPE_STYLE[type.toUpperCase()] : undefined;
}
```

`EDGE_TYPE_LABEL` gets the same upper-case keys plus `SOSTITUISCE: 'Sostituisce'`, `RINVIA: 'Rinvia a'`, `CORRELATO: 'Correlato'`, `ESPRIME: 'Esprime'`, `MENZIONA: 'Menziona'`, `DERIVA_DA: 'Deriva da'`, `VERSIONE_DI: 'Versione di'`; `humanizeEdgeType` looks up `EDGE_TYPE_LABEL[type.toUpperCase()]`. Replace `EDGE_TYPE_STYLE[x]` with `edgeTypeStyle(x)` at `graphStyles.ts:392`, `GraphFilterPanel.tsx:77` and `EdgeDetailsDrawer.tsx:53`.

`docs/merlt/claude-notes.md`: where the notes describe the graph surfaces and D2, say that since 30 September 2026 the side rail, `/grafo` (and with it the Q&A) and the BFF routes `/graph/article/:urn` and `/graph/ingest` are for administrators, and `/graph/search` stays for contributors.

- [ ] **Step 4: Run the tests; browser pass**

`npm --prefix apps/server test`, `npm --prefix apps/web run test -- --run`, `npm --prefix apps/web run build`, `npm --prefix apps/web run lint`. Expected: PASS. In the browser (`http://localhost:5173`): as `admin`, the side rail, `/grafo` and the hub's Q&A and graph cards work; as a non-admin account (register one through the app and activate it from the admin page), none of them appears, `/grafo` shows "Grafo non disponibile." and `GET /api/merlt/graph/article/…` answers 403 in the network panel. Screenshot both.

- [ ] **Step 5: Commit and open pull request D**

```bash
git add apps/server apps/web docs/merlt/claude-notes.md
git commit -m "feat: the knowledge graph is shown to validators only"
```

---

### Task 9: Close the round

**Files:**
- Modify: `services/merlt/CLAUDE.md` ("Conventions": the schema module is the vocabulary and the contract test ratchets it; "Tests": the unit-test command with the mounted checkout; "Critical files": `storage/graph/schema.py`)
- Modify: `docs/merlt/claude-notes.md` (a short "Vocabulary" section: canonical names, the migration and its report, the completeness check; and the community writer's rules below)
- Modify: `docs/superpowers/specs/2026-09-30-merlt-graph-structure-design.md` (status line: phase 1 done, with the four pull requests)

`claude-notes.md` also says, from pull request A's reviews:

- a proposal for an entity that already exists (a community duplicate or a seed twin) still gets the link from its article to that entity;
- a `Norma` stub made for a bare `urn:nir:` URN is keyed by its full Normattiva URL;
- an approved `PARTE_DI` is written as the reversed `CONTIENE`, and only between two norms; `schema.py`'s "PARTE_DI is never written" holds only as an edge type;
- the twin lookup folds accents and keeps the seed's own rule (`seed_twin_slug`), trying the name as spelt and then without a leading article (`seed_twin_slugs`);
- a community entity carries `node_id` equal to its `id`, and the readers name a node by `coalesce(URN, node_id)`.

- [ ] **Step 1:** Update the three documents. Every statement must be true of the merged code.
- [ ] **Step 2:** Run every suite the round touched: MERL-T (`tests/unit tests/pipeline tests/rlcf tests/api tests/scripts`, DB-backed ones against a disposable Postgres), `npm --prefix apps/server test`, `npm --prefix apps/web run test -- --run`, `npm --prefix apps/web run build`, `npm --prefix apps/web run lint`, `node --test '.claude/hooks/*.test.mjs'`.
- [ ] **Step 3:** Live check on the development stack (rebuilt images): a question to the experts on an article of Libro IV cites graph sources with their text (the literal expert's graph sources are no longer empty strings); a stub article read in the browser is completed with its commi; `MATCH ()-[r]->() RETURN DISTINCT type(r)` lists upper-case names only.
- [ ] **Step 4:** Commit the docs on a `docs/` branch, open the pull request, merge it.

---

## After phase 1

Not in this plan's four pull requests; each has its own place.

- **Estremi in the citation style the owner decided (1 October):** «art. 2, l. 7 agosto 1990, n. 241», codes and the Costituzione without a comma («art. 1284 c.c.», «art. 81 Cost.»). A small pull request after B: the schema's one estremi function in that style, numbered acts from the URN, `hierarchy.py`'s `n.estremi = $id` lookup made case-insensitive, an idempotent migration step rewriting stored estremi. The reference strings are in `apps/web/src/utils/__fixtures__/citationGolden.ts`, which the «Testo alla data» round adds.
- **`vendor/mcp-legal-it` to 2.15.0:** a separate pull request after the four of this plan.
- **Phase 2 notes:**
  - M6: abbreviations for the preleggi, the disposizioni di attuazione, the norme in materia ambientale, the protezione civile code and the military penal codes.
  - M7: duplicates in the entity picker.
  - The LLM enrichment writer stamps no provenance (reachable only from `cleanup_dottrina`).
  - The start lookups of the tools scan every node.
  - `FalkorDBClient.close()` does not release its connection pool.
  - `POST /api/v1/graph/search` filters on an `entity_type` payload key no writer sets, opens a connection pool per request, and asks the bridge once per chunk.
  - A label filter with several labels is a scan of every node (`definition_lookup`'s `source_types`, `verify_sources`' `node_types`).
  - `merlt/api/models/ner_models.py` (imported by nothing) keeps a class-based Pydantic `Config`.
- **The BFF's `normalizeGraphUrn`** (`apps/server/src/services/merlt/graphClient.ts`) cuts any string at its first `!` or `@`: it should cut only norm references, as `schema.canonical_urn` does. An Italgiure `LiveSource` used as a subgraph root is cut today (it was before this round too).
