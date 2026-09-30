# MERL-T graph, phase 1: one vocabulary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every writer and every reader of the MERL-T knowledge graph uses one vocabulary (labels, relation types, text property, URN form, estremi, provenance, fonte, Qdrant ids and source types); the existing graph is migrated to it; reading an article completes it instead of only checking that it exists; the graph is shown to validators only.

**Architecture:** one Python module, `services/merlt/merlt/storage/graph/schema.py`, defines the vocabulary. A static contract test reads every string literal under `services/merlt/merlt/` and fails when a Cypher string names a relation, a label, a `fonte` or a `provenance` the module does not define; its lists of known offenders shrink task by task and end empty. Names built at runtime (maps, lists handed to the graph tool) are pinned by tests of their own, and the graph search tool resolves whatever name a caller passes through the schema. A one-off idempotent script migrates FalkorDB and Qdrant. MERL-T's check-article answers "complete?"; the BFF and the web app restrict the graph to administrators.

**Tech Stack:** Python 3.11 (MERL-T: FastAPI, FalkorDB, qdrant-client, pytest with `asyncio_mode = "auto"`), Node/TypeScript (BFF: Express, Prisma, vitest + supertest + nock), React 19 (vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-09-30-merlt-graph-structure-design.md`, sections 4 and 6.5. Phase 2 (complete ingestion) and the rest of phase 3 get their own plans.

## Global Constraints

- Relation types are **UPPER CASE**. A reference between norms is `RINVIA` (never `CITA`, `cita`, `rinvia`, `richiama`); the structure is `CONTIENE` (partition → partition → article → comma → lettera); a community entity's link to the live source it came from is `DERIVA_DA`.
- Labels keep the seed's names (`Norma`, `Comma`, `AttoGiudiziario`, `ConcettoGiuridico`, …). Partitions and acts are `Norma` nodes told apart by `tipo_documento`, as today.
- The canonical URN is the **full Normattiva URL** with the version marker (`!vig=…`, `!orig=…`, `@originale`) cut at the first `!` or `@`. The URL wrapper is never stripped: it is the seed's key.
- `estremi`: `Art. <numero> <abbreviation>` from the one abbreviation table (`Art. 1 Cost.`, `Art. 1321 c.c.`); for an act the table does not know, `Art. <numero>` plus whatever the writer knows.
- `fonte` values: `Normattiva`, `Brocardi.it`, `manuale:Torrente-libroiv`, `community`, `mcp-legal-it`, `italia_corpus`. `provenance` values: `seed`, `ingestion`, `community_validated`, `live_unconfirmed`, `confirmed`.
- The text of a node is read through `schema.node_text()`; `Norma` carries `testo` (and `testo_vigente` as an alias) plus `testo_sha256`, the SHA-256 of the exact text.
- Qdrant point ids are `uuid5(namespace, "<canonical URN>|<source_type>|<key>")`, never Python `hash()`; `key` is `0` for the one norm/ratio/spiegazione point of an article and the massima's index for a massima.
- `article_text` is a data contract (root `CLAUDE.md`, rule 23): the graph copies the text as it comes and never rewrites it.
- MERL-T tests never touch the development stack's stores. Unit tests, from the repository root: `docker run --rm -v "$PWD/services/merlt:/app" -w /app --entrypoint python visualex-merlt-worker:latest -m pytest <paths> -q -p no:cacheprovider` (the mounted code shadows the image's; the pytest options in `pyproject.toml` exclude `integration`). FalkorDB integration tests use a throwaway `falkordb/falkordb` container on a free port, never `visualex-falkordb`.
- MERL-T code is baked into its images: before any live check, `docker compose -f infra/compose.yml --profile merlt build merlt-api merlt-worker` and `… up -d --force-recreate merlt-api merlt-worker`.
- Data moves by export and import: `scripts/backup.sh` before the migration touches the development graph.
- Code, comments, commits and docs in English; UI copy in Italian. Nothing private in the repository.
- Git: one branch per pull request, from `develop`, Conventional Commits, merge commits titled `merge: <branch> — <what changes>` once CI is green.

Pull requests: **A** `refactor/merlt-graph-vocabulary` = Tasks 1–5. **B** `feat/merlt-graph-migration` = Task 6, after A. **C** `feat/merlt-article-completeness` = Task 7, after B **and after the migration has run on the development graph** (otherwise every article reads incomplete and is re-ingested on first view). **D** `feat/graph-validators-only` = Task 8, independent of A–C. Task 9 closes the round.

## Review Focus

1. **A URN that carries `@originale` or `!vig=…`** (the reader, the tracking payloads and the BFF all produce them) must reach the same node as the bare URL. Pinned by Task 1 (`canonical_urn`), Task 5 (the graph tool's start node) and Task 7 (check-article).
2. **A relation name built at runtime** — a map value, a list handed to the graph tool, an f-string placeholder — is invisible to the static contract test. Pinned by Task 3 (multivigenza map, seed edges), Task 4 (entity-writer map, community relations) and Task 5 (the experts' lists, the graph tool's resolution of legacy and policy names).
3. **The migration run twice, or restarted after a crash half-way,** must converge and report nothing the second time. Pinned by Task 6 (FalkorDB integration test, Qdrant in-memory tests, the upsert-then-crash case).
4. **The same article ingested by two processes** must produce the same Qdrant ids (Python's `hash()` is salted per process). Pinned by Task 1 (subprocess test) and Task 3 (the lazy writer's ids).
5. **A non-administrator calling the graph API directly** gets 403 even though the UI hides the graph — while contributors keep the entity search their picker needs; and **an article that stays incomplete** is not re-ingested on every view. Pinned by Task 8 and Task 7.

## Scope notes (what phase 1 leaves out, and why)

- **A page for the Q&A without the graph** (spec 6.5, last sentence). The Q&A lives on `/grafo`; Task 8 hides it together with the graph for non-administrators. A graph-free "Assistente" page is its own UI round, once the owner chooses.
- **Doctrine and vectors in the completeness check** (spec 4.3). Phase 1 checks text, commi, hierarchy and fingerprint. Adding the other two now would re-ingest all 889 seed articles on first view and duplicate their vectors, because seed and lazy points are keyed differently until phase 2 re-ingests.
- **A stored, dated completeness record** (spec 4.3). Phase 1 derives completeness from the graph itself, which cannot go stale; the dated record comes with phase 2, together with the two parts above.
- **Massime payload fields** (`autorita`, `numero`, `anno`) and the full doctrine layer: phase 2.
- **Existing concept twins**: the migration reports them (the development graph has none); the entity writer merges new ones (Task 4).
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

- [ ] **Step 5: Commit, then open pull request A**

```bash
git add -A services/merlt
git commit -m "refactor(merlt): the experts, tools, retriever and policy read the schema's vocabulary"
git push -u origin refactor/merlt-graph-vocabulary
```

Pull request into `develop` for Tasks 1–5; after CI and the review, merge with `merge: refactor/merlt-graph-vocabulary — one vocabulary for the graph's writers and readers`.

---

### Task 6: Migrate the existing graph and its vectors

**Files:**
- Create: `services/merlt/merlt/scripts/migrate_graph_vocabulary.py`
- Test: `services/merlt/tests/scripts/test_migrate_graph_vocabulary.py` (unit: estremi plan, Qdrant in memory), `services/merlt/tests/scripts/test_migrate_graph_vocabulary_integration.py` (`integration`: throwaway FalkorDB)
- Modify: `services/merlt/tests/unit/test_graph_vocabulary_contract.py` (`EXEMPT` gains the script: it must name the old relations to rename them)

**Interfaces:**
- Consumes: `LEGACY_REL`, `LEGACY_SOURCE_TYPE`, `Label`, `Provenance`, `Rel`, `SEED_TWIN`, `canonical_urn`, `act_name_from_urn`, `estremi_from_urn`, `normalize_fonte`, `point_id`, `text_fingerprint` (Task 1); `FalkorDBClient`, `FalkorDBConfig`; `qdrant_client`; `merlt.scripts.load_seed_libro_iv.SEED_GRAPH_JSON`; `merlt.storage.vectors.collection.default_chunks_collection`.
- Produces: `python -m merlt.scripts.migrate_graph_vocabulary [--apply] [--batch N]` printing `{"applied", "graph": {"relations", "stubs", "estremi", "provenance", "fonte", "testo", "fingerprint", "twins"}, "vectors": {"rekeyed", "duplicates_dropped", "retyped", "urns_canonicalized"}}`; `async migrate_graph(client, *, apply, batch, seed_keys) -> dict`; `migrate_qdrant(client, collection, *, apply, batch=256) -> dict`; `plan_estremi(rows) -> list[dict]`; `plan_qdrant(points) -> dict`.

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

    docker run -d --rm --name vx-mig-falkor -p 127.0.0.1:6399:6379 falkordb/falkordb
    MIGRATION_TEST_FALKORDB=host.docker.internal:6399 python -m pytest tests/scripts -m integration
"""
import os

import pytest

from merlt.scripts import migrate_graph_vocabulary as mig
from merlt.storage.graph import FalkorDBClient, FalkorDBConfig
from merlt.storage.graph.schema import text_fingerprint

pytestmark = pytest.mark.integration

CODE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2"
ART, STUB = CODE + "~art1321", CODE + "~art1322"
TEXT = "Testo dell'articolo."
DOTTRINA = "dottrina_brocardi_art1321_ratio"
SEED_KEYS = {ART, DOTTRINA}

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


@pytest.fixture
async def graph():
    host, port = os.environ["MIGRATION_TEST_FALKORDB"].rsplit(":", 1)
    client = FalkorDBClient(FalkorDBConfig(host=host, port=int(port), graph_name="migration_test"))
    await client.connect()
    await client.query("MATCH (n) DETACH DELETE n")
    await client.query(LEGACY, {"code": CODE, "art": ART, "stub": STUB, "text": TEXT, "dottrina": DOTTRINA})
    yield client
    await client.query("MATCH (n) DETACH DELETE n")
    await client.close()


async def _types(client) -> set[str]:
    return {row["t"] for row in await client.query("MATCH ()-[r]->() RETURN DISTINCT type(r) AS t")}


async def test_the_migration_converges_on_the_schema(graph):
    report = await mig.migrate_graph(graph, apply=True, batch=2, seed_keys=SEED_KEYS)
    assert report == {
        "relations": {"CITA→DERIVA_DA": 1, "contiene": 1, "commenta": 1, "CITA": 1},
        "stubs": 1,
        "estremi": 2,
        "provenance": {"seed": 2, "ingestion": 1},
        "fonte": {"VisualexAPI": 2, "Brocardi": 1, "community_validation": 1},
        "testo": 2,
        "fingerprint": 1,
        "twins": [],
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
    assert dry == await mig.migrate_graph(graph, apply=True, batch=2, seed_keys=SEED_KEYS)


async def test_a_second_run_changes_nothing(graph):
    await mig.migrate_graph(graph, apply=True, batch=2, seed_keys=SEED_KEYS)
    assert await mig.migrate_graph(graph, apply=True, batch=2, seed_keys=SEED_KEYS) == {
        "relations": {}, "stubs": 0, "estremi": 0, "provenance": {}, "fonte": {},
        "testo": 0, "fingerprint": 0, "twins": [],
    }
```

- [ ] **Step 2: Run the unit tests; start a throwaway FalkorDB and run the integration test**

```bash
docker run --rm -v "$PWD/services/merlt:/app" -w /app --entrypoint python visualex-merlt-worker:latest -m pytest tests/scripts/test_migrate_graph_vocabulary.py -q -p no:cacheprovider
docker run -d --rm --name vx-mig-falkor -p 127.0.0.1:6399:6379 falkordb/falkordb
docker run --rm -e MIGRATION_TEST_FALKORDB=host.docker.internal:6399 -v "$PWD/services/merlt:/app" -w /app --entrypoint python visualex-merlt-worker:latest -m pytest tests/scripts/test_migrate_graph_vocabulary_integration.py -m integration -q -p no:cacheprovider
```

Expected: FAIL — no module `merlt.scripts.migrate_graph_vocabulary`.

- [ ] **Step 3: Write the script**

```python
# services/merlt/merlt/scripts/migrate_graph_vocabulary.py
"""Migrate the MERL-T graph and its vectors to the schema's vocabulary.

Dry run by default: it reads and reports. `--apply` writes. Idempotent: a second
run reports nothing. Run `scripts/backup.sh` first.
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
from merlt.storage.graph.schema import (
    LEGACY_REL, LEGACY_SOURCE_TYPE, SEED_TWIN, Label, Provenance, Rel,
    act_name_from_urn, canonical_urn, estremi_from_urn, normalize_fonte, point_id, text_fingerprint,
)

log = structlog.get_logger()

# Every label that carries content; community entities and live sources stamp their own provenance.
PROVENANCE_LABELS = [label for label in Label if label not in (Label.ENTITY, Label.LIVE_SOURCE)]
_STUB_WHERE = "(n.is_stub = true OR (n.tipo_documento IS NULL AND n.testo IS NULL AND n.testo_vigente IS NULL))"


def _chunks(items: list, size: int) -> Iterable[list]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


async def _count(client, cypher: str, params: dict | None = None) -> int:
    rows = await client.query(cypher, params or {})
    return int(rows[0]["n"]) if rows else 0


async def rename_relations(client, apply: bool, batch: int) -> dict[str, int]:
    """FalkorDB cannot rename a relation type: each legacy edge is copied to its
    canonical type with its properties, then deleted — in batches, one
    statement each (atomic per batch)."""
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
                f"CREATE (a)-[n:`{new.value}`]->(b) SET n = properties(r) DELETE r RETURN count(n) AS n",
            )
            if not moved:
                break
    return report


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


async def stamp_provenance(client, apply: bool, batch: int, seed_keys: set[str]) -> dict[str, int]:
    """`seed` for what the Libro IV seed brought, `ingestion` for the rest."""
    report: dict[str, int] = {}
    for label in PROVENANCE_LABELS:
        rows = await client.query(
            f"MATCH (n:{label.value}) WHERE n.provenance IS NULL RETURN id(n) AS id, coalesce(n.URN, n.node_id) AS key"
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


async def report_twins(client) -> list[str]:
    """Community entities with a seed twin. Reported, never merged here: the
    entity writer merges new ones (Task 4); an existing pair needs a decision."""
    twins = []
    for row in await client.query("MATCH (e:Entity) RETURN e.id AS id, e.tipo AS tipo"):
        twin = SEED_TWIN.get(row.get("tipo") or "")
        if not twin or not row.get("id"):
            continue
        label, prefix = twin
        slug = row["id"].split(":", 1)[-1]
        if await _count(
            client, f"MATCH (c:{label.value} {{node_id: $nid}}) WHERE NOT c:Entity RETURN count(c) AS n",
            {"nid": f"{prefix}:{slug}"},
        ):
            twins.append(row["id"])
    return twins


async def migrate_graph(client, *, apply: bool, batch: int = 500, seed_keys: set[str]) -> dict[str, Any]:
    return {
        "relations": await rename_relations(client, apply, batch),
        "stubs": await unify_stubs(client, apply),
        "estremi": await rewrite_estremi(client, apply, batch),
        "provenance": await stamp_provenance(client, apply, batch, seed_keys),
        "fonte": await normalize_fonti(client, apply),
        "testo": await copy_text(client, apply, batch),
        "fingerprint": await stamp_fingerprints(client, apply, batch),
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

(FalkorDB's `SET n:Label`, `properties(r)` and the copy-then-delete statement were checked on the development FalkorDB, in a scratch graph deleted afterwards, on 30 September.)

Add `ROOT / "scripts" / "migrate_graph_vocabulary.py"` to the contract test's `EXEMPT`.

- [ ] **Step 4: Run the tests to verify they pass; stop the throwaway FalkorDB**

Run both test commands of Step 2 again. Expected: PASS. Then `docker stop vx-mig-falkor`.

- [ ] **Step 5: Migrate the development graph**

Rebuild and recreate `merlt-api` and `merlt-worker` from this branch, then:

```bash
scripts/backup.sh
docker exec visualex-merlt-worker python -m merlt.scripts.migrate_graph_vocabulary
docker exec visualex-merlt-worker python -m merlt.scripts.migrate_graph_vocabulary --apply
docker exec visualex-merlt-worker python -m merlt.scripts.migrate_graph_vocabulary
```

Read the dry run before applying; the last run must report nothing. Record in the pull request the backup folder, the three reports, and the label and relation counts before and after (`MATCH (n) RETURN labels(n)[0], count(*)`, `MATCH ()-[r]->() RETURN type(r), count(*)`).

- [ ] **Step 6: Commit and open pull request B**

```bash
git add services/merlt/merlt/scripts/migrate_graph_vocabulary.py services/merlt/tests
git commit -m "feat(merlt): migrate the graph and its vectors to the one vocabulary"
```

---

### Task 7: "Complete?" instead of "exists?"

**Files:**
- Modify: `services/merlt/merlt/api/graph_router.py:50-111` (check-article)
- Modify: `apps/server/src/services/merlt/graphClient.ts:40-44` (`CheckArticleResponse`)
- Modify: `apps/server/src/services/merlt/lazyIngest.ts` (`ingestedRecently`)
- Modify: `apps/server/src/routes/merlt/events.ts:~121-139` (the lazy trigger)
- Test: `services/merlt/tests/api/test_check_article_completeness.py` (new); `apps/server/tests/integration/merlt/graph/lazy-trigger-completeness.test.ts` (new)

**Interfaces:**
- Consumes: `canonical_urn`, `ARTICLE_COMPLETENESS_PARTS` (Task 1); `testo`, `testo_sha256`, `CONTIENE` in the graph (Tasks 3–6).
- Produces: `GET /api/v1/graph/check-article` → `{exists, complete, missing: string[], node_id?, pending_validation?}` with `missing ⊆ ["node", "text", "commi", "hierarchy", "fingerprint"]`; `graph_router.article_missing_parts(row) -> list[str]`; BFF `ingestedRecently(prisma, urn): Promise<boolean>`.

Deploy after the migration has run (Task 6, Step 5): before it, no article has a fingerprint and every view would enqueue an ingestion.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/api/test_check_article_completeness.py
"""check-article answers "complete?" (spec 2026-09-30, §4.3)."""
from unittest.mock import AsyncMock, MagicMock, patch

from merlt.api.graph_router import _CHECK_ARTICLE_CYPHER, check_article_in_graph

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
    assert client.query.await_args.args[1] == {"urn": CC}  # the version marker never reaches the graph


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
    assert "(parent)-[:CONTIENE]->(a)" in _CHECK_ARTICLE_CYPHER
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

MERL-T: `… -m pytest tests/api/test_check_article_completeness.py -q -p no:cacheprovider`. BFF: `npm --prefix apps/server test -- lazy-trigger-completeness` (its setup refuses a non-test database; `apps/server/CLAUDE.md`). Expected: FAIL.

- [ ] **Step 3: Implement**

`api/graph_router.py`:

```python
from merlt.storage.graph.schema import ARTICLE_COMPLETENESS_PARTS, canonical_urn

_CHECK_ARTICLE_CYPHER = """
MATCH (a:Norma)
WHERE a.URN = $urn OR a.node_id = $urn
OPTIONAL MATCH (a)-[:CONTIENE]->(c:Comma)
WITH a, count(c) AS commi
OPTIONAL MATCH (parent)-[:CONTIENE]->(a)
RETURN
    COALESCE(a.node_id, a.URN) AS node_id,
    coalesce(a.is_stub, false) AS is_stub,
    coalesce(a.testo, a.testo_vigente, '') <> '' AS has_text,
    commi,
    count(parent) AS parents,
    a.testo_sha256 IS NOT NULL AS has_fingerprint,
    false AS pending_validation
"""


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

In `check_article_in_graph`: the docstring says it answers "complete?" and lists the parts; it queries `_CHECK_ARTICLE_CYPHER` with `{"urn": canonical_urn(article_urn)}` and answers

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

With the migrated development graph and rebuilt MERL-T images: `curl "http://127.0.0.1:8000/api/v1/graph/check-article?article_urn=<a seed article URL>"` answers `complete: true`; on a stub it answers `missing: ["text","commi","hierarchy","fingerprint"]`; reading that stub's article in the browser enqueues one job, and after it completes the check answers `complete: true`.

```bash
git add services/merlt/merlt/api/graph_router.py services/merlt/tests/api apps/server/src apps/server/tests
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
- Modify: `docs/merlt/claude-notes.md` (a short "Vocabulary" section: canonical names, the migration and its report, the completeness check)
- Modify: `docs/superpowers/specs/2026-09-30-merlt-graph-structure-design.md` (status line: phase 1 done, with the four pull requests)

- [ ] **Step 1:** Update the three documents. Every statement must be true of the merged code.
- [ ] **Step 2:** Run every suite the round touched: MERL-T (`tests/unit tests/pipeline tests/rlcf tests/api tests/scripts`, DB-backed ones against a disposable Postgres), `npm --prefix apps/server test`, `npm --prefix apps/web run test -- --run`, `npm --prefix apps/web run build`, `npm --prefix apps/web run lint`, `node --test '.claude/hooks/*.test.mjs'`.
- [ ] **Step 3:** Live check on the development stack (rebuilt images): a question to the experts on an article of Libro IV cites graph sources with their text (the literal expert's graph sources are no longer empty strings); a stub article read in the browser is completed with its commi; `MATCH ()-[r]->() RETURN DISTINCT type(r)` lists upper-case names only.
- [ ] **Step 4:** Commit the docs on a `docs/` branch, open the pull request, merge it.
