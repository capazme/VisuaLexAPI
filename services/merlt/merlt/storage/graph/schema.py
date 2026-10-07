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
import math
import uuid
from enum import Enum
from typing import Any, Iterable, Mapping, Optional, Union

import structlog

from merlt.utils.map import NORMATTIVA_URN_CODICI
from merlt.utils.sources import short_from_urn
from merlt.utils.urn_labels import article_number_from_urn

log = structlog.get_logger()


class _Vocab(str, Enum):
    """A vocabulary member renders as its value in f-strings, str() and format()."""

    def __str__(self) -> str:
        return self.value


class Label(_Vocab):
    """Node labels: the seed's, plus the ones later writers add."""

    NORMA = "Norma"  # an article, an act or a partition (tipo_documento says which)
    COMMA = "Comma"
    LETTERA = "Lettera"
    NUMERO = "Numero"  # multivigenza writes the numbers a modification targets
    DOTTRINA = "Dottrina"
    # Today the seed's node is a massima, keyed `massima_<corte>_<numero>`. Phase 2 makes
    # the node the ruling (the pronuncia), keyed by the shared decision identity, with its
    # massime as attributes (owner's decision, 1 October; spec 5.1). Phase 1 changes no key.
    ATTO_GIUDIZIARIO = "AttoGiudiziario"
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
    ENTITY = "Entity"  # a community entity, written as :Entity:<Label> (ENTITY_LABEL_BY_TYPE)
    LIVE_SOURCE = "LiveSource"  # a source the co-evolution retrieved live


class Rel(_Vocab):
    """Relation types, all upper case: the graph's own plus every community
    RelationType the graph can receive (CITA arrives as RINVIA; PARTE_DI, the
    inverse of CONTIENE, is never written as such: the enrichment router writes
    it as the reversed CONTIENE)."""

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
    SPIEGA = "SPIEGA"  # dottrina → concetto (enrichment writer templates)
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
_LABEL_BY_LOWER: dict[str, Label] = {label.value.lower(): label for label in Label}

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

_LEGACY_BY_LOWER: dict[str, Rel] = {name.lower(): rel for name, rel in LEGACY_REL.items()}

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
    """The graph relation a reader means, whatever case or vocabulary it used
    (`CITA`, `Cita` and `richiama` are all RINVIA).
    An unknown name comes back unchanged: a filter on it matches nothing, as before."""
    legacy = _LEGACY_BY_LOWER.get(name.lower())
    if legacy is not None:
        return legacy.value
    if name.upper() in _REL_VALUES:
        return name.upper()
    alias = REL_ALIASES.get(name.lower())
    return alias.value if alias else name


def resolve_rels(names: Iterable[str]) -> list[str]:
    """`resolve_rel` over a list, keeping the order and dropping repeats."""
    return list(dict.fromkeys(resolve_rel(n) for n in names))


def _as_names(names: Union[str, Iterable[Any]]) -> list[Any]:
    """A lone name is a list of one: iterating a string would hand out its characters."""
    return [names] if isinstance(names, str) else list(names)


def cypher_rel_names(names: Union[str, Iterable[Any]]) -> list[str]:
    """The relation types a Cypher pattern may name, from names a caller chose.

    Relation types cannot be Cypher parameters, so a tool interpolates them into the
    query text, and its argument comes from an LLM that reads retrieved text. Each
    name goes through `resolve_rel` and only a `Rel` value survives: order kept,
    repeats dropped, everything else (unknown names, anything that is not a string,
    anything that could carry Cypher) dropped. An empty answer means the caller
    named nothing the graph has: the tool must not run the query unfiltered."""
    resolved = (resolve_rel(n.strip()) for n in _as_names(names) if isinstance(n, str))
    return list(dict.fromkeys(r for r in resolved if r in _REL_VALUES))


def cypher_labels(names: Union[str, Iterable[Any]]) -> list[str]:
    """The node labels a Cypher pattern may name, from names a caller chose: matched
    case-insensitively against `Label` and returned in the canonical spelling. Like
    `cypher_rel_names`, anything else is dropped and an empty answer means "run no
    query"."""
    found = (_LABEL_BY_LOWER.get(n.strip().lower()) for n in _as_names(names) if isinstance(n, str))
    return list(dict.fromkeys(label.value for label in found if label is not None))


def community_rel_to_graph(value: str) -> Rel:
    """The graph relation a community-validated RelationType value is written as.

    PARTE_DI has none as such: it is the inverse of CONTIENE, so the writer that
    knows the endpoints swaps them and writes CONTIENE
    (`enrichment_router._write_relation_to_graph`)."""
    if value == "PARTE_DI":
        raise ValueError(
            "PARTE_DI is the inverse of CONTIENE and is never written as such: "
            "write CONTIENE with the endpoints swapped"
        )
    return canonical_rel(value)


class SourceType(_Vocab):
    """Qdrant `source_type` values."""

    NORMA = "norma"
    COMMA = "comma"
    RATIO = "ratio"
    SPIEGAZIONE = "spiegazione"
    DOTTRINA = "dottrina"
    MASSIMA = "massima"
    CONCETTO = "concetto"
    TEXT = "text"  # a live source of no known kind: no expert searches it
    RASSEGNA = "rassegna"  # a paragraph of the Massimario's annual reviews


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


class Provenance(_Vocab):
    SEED = "seed"
    INGESTION = "ingestion"
    COMMUNITY_VALIDATED = "community_validated"
    LIVE_UNCONFIRMED = "live_unconfirmed"
    CONFIRMED = "confirmed"


class Fonte(_Vocab):
    NORMATTIVA = "Normattiva"
    BROCARDI = "Brocardi.it"
    TORRENTE = "manuale:Torrente-libroiv"
    COMMUNITY = "community"
    MCP_LEGAL_IT = "mcp-legal-it"
    ITALIA_CORPUS = "italia_corpus"
    MASSIMARIO = "Ufficio del Massimario"  # the Corte di cassazione's annual reviews


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
    "massimario": Fonte.MASSIMARIO,
    "ufficio del massimario": Fonte.MASSIMARIO,
}


# The node properties that are flags. The Libro IV seed writes them as the strings 'true' and
# 'false' (abrogato 34, is_versione_vigente 34, multivigenza_enabled 34, community_validated 1;
# no edge carries one), and in Python the string 'false' is truthy. `is_stub` is a flag too,
# and the stub shape (`stub_properties`) owns it.
BOOLEAN_PROPERTIES: tuple[str, ...] = ("abrogato", "community_validated", "is_versione_vigente", "multivigenza_enabled")


def boolean_flag(value: Any) -> Optional[bool]:
    """A flag as the boolean it means: a boolean as it is, the string 'true' or 'false' in
    any case and with any surrounding space; None for anything else (a number included),
    which is no flag."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return {"true": True, "false": False}.get(value.strip().lower())
    return None


def certezza_number(value: Any) -> Optional[float]:
    """A relation's `certezza` as the number it is written as, or None when it is none.

    The seed wrote it as a string ("0.9", "1"); a string never compares with a number,
    so edges ordered by it fell apart. Parsed in Python: FalkorDB's `toFloat` reads a
    string in single precision ('0.9' becomes 0.899999976…), which would set a seed
    edge just below a community edge of the same value."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str) and "_" not in value:  # float() reads '1_0' as 10.0
        try:
            number = float(value)
        except ValueError:
            return None
    else:
        return None
    return number if math.isfinite(number) else None


def normalize_fonte(value: Optional[str]) -> Optional[str]:
    """The canonical fonte. An unknown value passes through: never lost."""
    if value is None:
        return None
    hit = _FONTE_ALIASES.get(value.strip().lower())
    return hit.value if hit else value


def canonical_urn(urn: Optional[str]) -> Optional[str]:
    """The graph key of a norm: the full Normattiva URL with the version marker
    (`!vig=…`, `!orig=…`, `@originale`) cut off. The URL wrapper is never
    stripped: the seed keys every node with it.

    This is the one function: every writer and reader that keys a norm calls it (a
    caller that has more to do, a `strip`, does it around the call). The marker is a
    NIR concept, so a string that is not a norm reference (a case-law URL, a node id)
    is no norm's key and comes back as it is: an Italgiure document id holds `@`
    between its parts (`…/snciv@s10@a2021@n18325@tS.clean.pdf`), and cutting there
    would give every ruling of the same day and database one key. For a norm it does
    what the BFF's `graphClient.normalizeGraphUrn` does; that one cuts any string at
    the first `!` or `@`, and is only ever handed a norm."""
    if not urn or not _is_norm_reference(urn):
        return urn
    cut = len(urn)
    for mark in ("!", "@"):
        at = urn.find(mark)
        if at != -1:
            cut = min(cut, at)
    return urn[:cut]


def _is_norm_reference(value: str) -> bool:
    """A NIR URN, bare or wrapped in the Normattiva URL (what a version marker follows)."""
    lowered = value.lower()
    return lowered.startswith("urn:") or "urn:nir:" in lowered


_ACT_BY_URN: dict[str, str] = {urn.lower(): name for name, urn in NORMATTIVA_URN_CODICI.items()}


def act_name_from_urn(urn: Optional[str]) -> Optional[str]:
    """The code an article URN belongs to ("codice civile"), from the URN
    table; None for any act the table does not list."""
    if not urn:
        return None
    body = (canonical_urn(urn) or "").split("urn:nir:stato:", 1)[-1]
    return _ACT_BY_URN.get(body.split("~", 1)[0].lower())


def estremi_from_urn(urn: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """`(numero_articolo, estremi)` from a URN, `(None, None)` without an article. The
    estremi are the norm's short label of the source convention (`art. 2043 c.c.`,
    `art. 2 l. 241/1990`, `utils/sources.py`), read from the key alone; `art. N` when the
    key names no act the convention can read."""
    numero = article_number_from_urn(urn)
    if numero is None:
        return None, None
    return numero, (short_from_urn(urn) or f"art. {numero}")


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
# 4.3; the doctrine layer and the vectors join in phase 2). Its "fingerprint" is
# `Norma.testo_sha256`, see the note below.
ARTICLE_COMPLETENESS_PARTS: tuple[str, ...] = ("text", "commi", "hierarchy", "fingerprint")

# Two fingerprints exist, and they are two properties:
#
# - `testo_sha256` is the SHA-256 of `article_text`, the text VisuaLex serves (what
#   `text_fingerprint` computes, from the text the writers store as `testo`).
# - `akn_sha256` is the per-article `fingerprint` that `/fetch_act_fingerprints` returns:
#   the SHA-256 of the AKN article text (services/visualex/visualex_api/services/
#   akn_fetch.py, `_fingerprints`).
#
# AKN and HTML text are never identical (root CLAUDE.md, rule 23: 0 of 19 measured), so
# the two hashes of one article never match. `akn_sha256` never overwrites `testo_sha256`
# and the two are never compared as if they were one hash. Which of them LingoLex
# anchors on is decided in phase 3.


def text_fingerprint(text: str) -> str:
    """SHA-256 of the exact text (article_text is a data contract): the value of
    `testo_sha256`, never of the AKN fingerprint `akn_sha256`."""
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

# A community entity type (`pipeline/enrichment/models.EntityType`, by value) → the schema
# label its node carries next to `Entity`, so that it is written `:Entity:<Label>` and reads
# as what it is: the seed's concept, principle, ruling... A type with no label of the schema
# is `:Entity` alone, and that includes the structural types, whose labels belong to the
# ingestion writers (a `:Comma` is a part of an article with a URN, a `:Norma` an article or
# an act). Every EntityType value has a line here (`tests/unit/test_graph_schema.py`).
ENTITY_LABEL_BY_TYPE: dict[str, Optional[Label]] = {
    # normative sources and the textual structure
    "norma": None,
    "versione": None,
    "direttiva_ue": None,
    "regolamento_ue": None,
    "comma": None,
    "lettera": None,
    "numero": None,
    "definizione": Label.DEFINIZIONE_LEGALE,
    "definizione_legale": Label.DEFINIZIONE_LEGALE,
    # case law and doctrine
    "atto_giudiziario": Label.ATTO_GIUDIZIARIO,
    "caso": Label.CASO,
    "dottrina": Label.DOTTRINA,
    "precedente": Label.ATTO_GIUDIZIARIO,
    "brocardo": Label.LOCUZIONE_LATINA,
    # subjects and roles
    "soggetto_giuridico": Label.SOGGETTO_GIURIDICO,
    "ruolo_giuridico": Label.RUOLO,
    "organo": None,
    # legal concepts
    "concetto": Label.CONCETTO_GIURIDICO,
    "principio": Label.PRINCIPIO_GIURIDICO,
    "diritto_soggettivo": None,
    "interesse_legittimo": None,
    "responsabilita": Label.RESPONSABILITA,
    # dynamics
    "fatto_giuridico": Label.FATTO_GIURIDICO,
    "procedura": Label.PROCEDURA,
    "sanzione": Label.SANZIONE,
    "termine": Label.TERMINE,
    # logic and reasoning
    "regola": None,
    "proposizione": None,
    "modalita_giuridica": Label.MODALITA_GIURIDICA,
}


def entity_label(entity_type: str) -> Optional[Label]:
    """The schema label a new community entity of this type is written with next to
    `Entity`; None for a type that has none (it is written `:Entity` alone)."""
    return ENTITY_LABEL_BY_TYPE.get(entity_type)


def node_type_from_labels(labels: Optional[Iterable[str]], default: Optional[str] = None) -> Optional[str]:
    """What a node reads as: its first label that is not `Entity`; `Entity` when that is
    all it carries; `default` when it has no label.

    FalkorDB orders a node's labels by label id, so `labels[0]` of a community entity
    (`:Entity:PrincipioGiuridico`) is `Entity` on a graph where that label came first, and
    the experts that look for a principle or a ruling by its type drop the node."""
    names = [name for name in (labels or []) if isinstance(name, str)]
    for name in names:
        if name != Label.ENTITY.value:
            return name
    return names[0] if names else default


def node_type_cypher(variable: str) -> str:
    """The Cypher expression for `node_type_from_labels` on the node bound to `variable`:
    its first label that is not `Entity`, else the first it has (null without labels).
    `variable` is a name the calling code wrote, never a tool argument."""
    return (
        f"coalesce([lbl IN labels({variable}) WHERE lbl <> '{Label.ENTITY.value}'][0], labels({variable})[0])"
    )


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
    is open (spec section 11).

    A version has a date: `<URL>!vig=` with nothing after it is the marker of the
    live article, so an empty or missing date raises instead of building it."""
    if not version_date or not isinstance(version_date, str):
        raise ValueError(f"a version key needs a date, got {version_date!r}")
    return f"{canonical_urn(urn)}!vig={version_date}"
