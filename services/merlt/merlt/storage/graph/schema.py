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


class Rel(_Vocab):
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
