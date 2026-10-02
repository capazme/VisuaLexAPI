"""
Temporal Validity Service
==========================

Service per verificare la vigenza temporale delle norme citate nei trace MERL-T.

Per ogni URN citata:
- Controlla se la norma è ancora in vigore nel grafo FalkorDB
- Rileva modifiche, abrogazioni, sostituzioni
- Genera warning strutturati in italiano
- Supporta as_of_date per verifiche relative a una data specifica

Il check è a render-time (non stored) con cache in-memory TTL 24h.

Pattern analogo a TraceStorageService per dependency injection.

Usage:
    service = TemporalValidityService(graph_db=falkordb_client)
    result = await service.check_validity("urn:nir:stato:codice.penale:1930;art52")
    summary = await service.check_trace_validity(trace_id, trace_service)
"""

import asyncio
import re
import time
import structlog
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from merlt.storage.graph.schema import boolean_flag, canonical_urn

log = structlog.get_logger()

# Cache TTL: 24 hours
CACHE_TTL_SECONDS = 86400

# ISO date format YYYY-MM-DD
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate_as_of_date(value: Optional[str]) -> Optional[str]:
    """
    Validate as_of_date format (YYYY-MM-DD).

    Returns:
        The validated date string, or None if input is None.

    Raises:
        ValueError: If the format is invalid.
    """
    if value is None:
        return None
    if not _ISO_DATE_RE.match(value):
        raise ValueError(
            f"as_of_date deve essere in formato ISO YYYY-MM-DD, ricevuto: '{value}'"
        )
    return value


@dataclass
class ValidityResult:
    """Risultato verifica vigenza per singola norma."""
    urn: str
    status: str                              # "vigente" | "modificato" | "abrogato" | "sostituito" | "unknown"
    is_valid: bool                           # True se vigente senza modifiche rilevanti
    warning_level: str                       # "none" | "info" | "warning" | "critical"
    warning_message: Optional[str] = None    # Messaggio localizzato (IT)
    last_modified: Optional[str] = None      # Data ultima modifica
    modification_count: int = 0              # Numero modifiche totali
    abrogating_norm: Optional[Dict[str, Any]] = None   # {urn, estremi, date} se abrogato
    replacing_norm: Optional[Dict[str, Any]] = None    # {urn, estremi, date} se sostituito
    recent_modifications: List[Dict[str, Any]] = field(default_factory=list)  # Ultime modifiche
    checked_at: str = ""                     # ISO timestamp del check
    # Abrogazioni e sostituzioni che entrano in vigore dopo la data di riferimento:
    # [{type, date, by_urn, by_estremi}]. Non cambiano lo status a quella data.
    pending: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "urn": self.urn,
            "status": self.status,
            "is_valid": self.is_valid,
            "warning_level": self.warning_level,
            "warning_message": self.warning_message,
            "last_modified": self.last_modified,
            "modification_count": self.modification_count,
            "abrogating_norm": self.abrogating_norm,
            "replacing_norm": self.replacing_norm,
            "recent_modifications": self.recent_modifications,
            "checked_at": self.checked_at,
            "pending": self.pending,
        }


@dataclass
class ValiditySummary:
    """Summary aggregato per un trace."""
    trace_id: str
    as_of_date: Optional[str]
    total_sources: int
    valid_count: int
    warning_count: int
    critical_count: int
    unknown_count: int = 0
    results: List[ValidityResult] = field(default_factory=list)
    summary_message: Optional[str] = None    # Banner se ci sono problemi

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "trace_id": self.trace_id,
            "as_of_date": self.as_of_date,
            "total_sources": self.total_sources,
            "valid_count": self.valid_count,
            "warning_count": self.warning_count,
            "critical_count": self.critical_count,
            "unknown_count": self.unknown_count,
            "results": [r.to_dict() for r in self.results],
            "summary_message": self.summary_message,
        }


def _fold_status_rows(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """One answer from the status query's rows (one per pair of ends): the node's
    properties, the earliest abrogation and replacement in force at the reference date
    (`abr_*`, `sost_*`, None when there is none), and the pending ends, by date."""
    folded = {key: rows[0].get(key) for key in ("is_abrogated", "is_current", "mod_count", "last_modified", "effective_since")}
    pending: Dict[tuple, Dict[str, Any]] = {}
    for prefix, kind in (("abr", "abroga"), ("sost", "sostituisce")):
        in_force = []
        for row in rows:
            by_urn = row.get(f"{prefix}_urn")
            if by_urn is None:
                continue
            end = {"urn": by_urn, "estremi": row.get(f"{prefix}_estremi"), "date": row.get(f"{prefix}_date") or ""}
            if row.get(f"{prefix}_pending"):
                pending[(kind, by_urn, end["date"])] = {
                    "type": kind, "date": end["date"], "by_urn": by_urn, "by_estremi": end["estremi"],
                }
            else:
                in_force.append(end)
        # an undated end ('') sorts first: it counts now
        first = min(in_force, key=lambda end: end["date"]) if in_force else None
        folded[f"{prefix}_urn"] = first["urn"] if first else None
        folded[f"{prefix}_estremi"] = first["estremi"] if first else None
        folded[f"{prefix}_date"] = first["date"] if first else None
    folded["pending"] = sorted(pending.values(), key=lambda change: (change["date"], change["type"], change["by_urn"]))
    return folded


class TemporalValidityService:
    """
    Service per verifiche di vigenza temporale delle norme.

    Wrappa FalkorDBClient per query Cypher sulle proprietà
    di vigenza dei nodi Norma e sulle relazioni temporali
    (MODIFICA, ABROGA, SOSTITUISCE, INSERISCE).

    Note: le relazioni nel grafo FalkorDB usano i nomi dello schema
    (storage/graph/schema.py: ABROGA, MODIFICA, SOSTITUISCE, INSERISCE),
    come li scrive multivigenza.py RELATION_TYPES. Il campo `type` delle
    modifiche recenti resta in minuscolo (modifica, abroga, sostituisce, inserisce).

    Example:
        service = TemporalValidityService(graph_db=falkordb_client)
        result = await service.check_validity("urn:nir:stato:codice.penale:1930;art52")
        print(result.status)  # "vigente"
    """

    def __init__(self, graph_db: Any):
        """
        Args:
            graph_db: FalkorDBClient connesso al grafo
        """
        self.graph_db = graph_db
        self._cache: Dict[str, tuple] = {}  # key -> (ValidityResult, timestamp)
        self._cache_lock = asyncio.Lock()

        log.info("TemporalValidityService initialized")

    async def check_validity(
        self,
        urn: str,
        as_of_date: Optional[str] = None
    ) -> ValidityResult:
        """
        Verifica la vigenza di una singola norma.

        Args:
            urn: URN della norma da verificare
            as_of_date: Data opzionale per verifica relativa (ISO format YYYY-MM-DD)

        Returns:
            ValidityResult con status, warning e dettagli

        The reference date is `as_of_date`, else today: an abrogation or a replacement
        that takes effect after it does not end the norm at that date and is reported
        in `pending` (an undated one ends it now: nothing says it is in the future).
        """
        reference = (as_of_date or date.today().isoformat())[:10]
        # keyed by the reference date: a check "as of today" cached yesterday is not today's
        cache_key = f"{urn}:{reference}"

        # Check cache (lock protects concurrent access)
        async with self._cache_lock:
            cached = self._cache.get(cache_key)
            if cached:
                result, cached_at = cached
                if time.time() - cached_at < CACHE_TTL_SECONDS:
                    log.debug("validity_cache_hit", urn=urn)
                    return result

        # Query FalkorDB (outside lock — allow concurrent queries). The graph is asked
        # with its own key (no `!vig=`, `@originale`); the answer keeps the URN that
        # was asked, so the caller matches it to its own spelling.
        key = canonical_urn(urn)
        node_data = await self._query_norm_status(key, reference)

        modifications = []
        if node_data is not None:
            # "Modified" means modified as at the reference date: the incoming MODIFICA and
            # INSERISCE edges (an inserted comma is an amendment) in force by then, an
            # undated one included. ABROGA and SOSTITUISCE are never modifications: they
            # have their own status and `pending`. The node's `n_modifiche` (multivigenza
            # only, 34 of 1,539 seed articles) has no date and counts the abrogation too
            # (art. 1632 c.c.), so it no longer counts.
            node_data["mod_count"] = await self._count_modifications(key, reference)
            if node_data["mod_count"] > 0:
                modifications = await self._query_modifications(key)

        result = self._build_validity_result(urn, node_data, modifications, as_of_date)

        # Store in cache
        async with self._cache_lock:
            self._cache[cache_key] = (result, time.time())

        log.debug(
            "validity_checked",
            urn=urn,
            status=result.status,
            warning_level=result.warning_level
        )

        return result

    async def check_batch_validity(
        self,
        urns: List[str],
        as_of_date: Optional[str] = None
    ) -> List[ValidityResult]:
        """
        Verifica la vigenza di un batch di norme.

        Args:
            urns: Lista di URN da verificare
            as_of_date: Data opzionale per verifica relativa

        Returns:
            Lista di ValidityResult, uno per ogni URN
        """
        results = []
        for urn in urns:
            result = await self.check_validity(urn, as_of_date)
            results.append(result)
        return results

    async def check_trace_validity(
        self,
        trace_id: str,
        trace_service: Any,
        as_of_date: Optional[str] = None,
        consent_level: Optional[str] = None
    ) -> ValiditySummary:
        """
        Verifica la vigenza di tutte le fonti citate in un trace.

        Args:
            trace_id: ID del trace da verificare
            trace_service: TraceStorageService per recuperare il trace
            as_of_date: Data opzionale per verifica relativa
            consent_level: Livello consent del chiamante

        Returns:
            ValiditySummary con risultati aggregati

        Raises:
            ValueError: Se il trace non esiste
        """
        # Get trace
        trace = await trace_service.get_trace(trace_id, consent_level=consent_level)
        if not trace:
            raise ValueError(f"Trace {trace_id} not found")

        # Extract URNs from sources
        sources = trace.get("sources") or []
        urns = []
        for source in sources:
            urn = source.get("article_urn")
            if urn and urn not in urns:
                urns.append(urn)

        # Check validity for all URNs
        results = await self.check_batch_validity(urns, as_of_date)

        # Build summary
        valid_count = sum(1 for r in results if r.warning_level == "none")
        warning_count = sum(1 for r in results if r.warning_level == "warning")
        critical_count = sum(1 for r in results if r.warning_level == "critical")
        unknown_count = sum(1 for r in results if r.warning_level == "info")

        summary_message = self.build_summary_message(
            valid_count, warning_count, critical_count, unknown_count
        )

        return ValiditySummary(
            trace_id=trace_id,
            as_of_date=as_of_date,
            total_sources=len(results),
            valid_count=valid_count,
            warning_count=warning_count,
            critical_count=critical_count,
            unknown_count=unknown_count,
            results=results,
            summary_message=summary_message,
        )

    async def _query_norm_status(self, urn: str, as_of: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Query Cypher per ottenere status e proprietà del nodo Norma.

        Every ABROGA and SOSTITUISCE edge is read, each dated as the history tool dates an
        amendment (on the edge, `data_efficacia`, else the act's own date) and flagged
        pending when it takes effect after `as_of` (a parameter; default today). The
        answer keeps the node's properties and, for each kind of end, the earliest one in
        force at `as_of` (`abr_*`, `sost_*`) and the pending ones (`pending`).

        Returns:
            Dict con proprietà del nodo, o None se non trovato
        """
        cypher = """
            MATCH (norma {URN: $urn})
            OPTIONAL MATCH (norma)<-[r_abr:ABROGA]-(abrogante)
            OPTIONAL MATCH (norma)<-[r_sost:SOSTITUISCE]-(sostituto)
            WITH norma, r_abr, abrogante, r_sost, sostituto,
                coalesce(r_abr.data_efficacia, abrogante.data_atto, abrogante.data_vigore, '') AS abr_date,
                coalesce(r_sost.data_efficacia, sostituto.data_atto, sostituto.data_vigore, '') AS sost_date
            RETURN
                norma.abrogato AS is_abrogated,
                norma.is_versione_vigente AS is_current,
                norma.n_modifiche AS mod_count,
                norma.ultima_modifica AS last_modified,
                norma.data_inizio_vigenza AS effective_since,
                abrogante.URN AS abr_urn,
                abrogante.estremi AS abr_estremi,
                abr_date,
                (r_abr IS NOT NULL AND abr_date <> '' AND left(abr_date, 10) > $as_of) AS abr_pending,
                sostituto.URN AS sost_urn,
                sostituto.estremi AS sost_estremi,
                sost_date,
                (r_sost IS NOT NULL AND sost_date <> '' AND left(sost_date, 10) > $as_of) AS sost_pending
        """

        try:
            results = await self.graph_db.ro_query(
                cypher, {"urn": canonical_urn(urn), "as_of": (as_of or date.today().isoformat())[:10]}
            )
            if not results:
                return None
            return _fold_status_rows(results)
        except Exception as e:
            log.error("validity_query_failed", urn=urn, error=str(e))
            return None

    async def _count_modifications(self, urn: str, as_of: Optional[str] = None) -> int:
        """
        Query Cypher per contare le modifiche in entrata in vigore alla data di riferimento
        (archi MODIFICA e INSERISCE: un comma inserito e' una modifica; ABROGA e
        SOSTITUISCE hanno il loro stato). An edge counts when it takes effect on or before
        `as_of` (a parameter; default today), dated as the history tool dates it, or when
        it has no date.

        Returns:
            Numero di archi MODIFICA o INSERISCE in vigore a quella data (0 se non leggibile)
        """
        cypher = """
            MATCH (norma {URN: $urn})<-[r:MODIFICA|INSERISCE]-(modificante)
            WITH coalesce(r.data_efficacia, modificante.data_atto, modificante.data_vigore, '') AS mod_date
            WHERE mod_date = '' OR left(mod_date, 10) <= $as_of
            RETURN count(*) AS n
        """

        try:
            results = await self.graph_db.ro_query(
                cypher, {"urn": canonical_urn(urn), "as_of": (as_of or date.today().isoformat())[:10]}
            )
            return int(results[0]["n"]) if results else 0
        except Exception as e:
            log.error("modification_count_failed", urn=urn, error=str(e))
            return 0

    async def _query_modifications(self, urn: str) -> List[Dict[str, Any]]:
        """
        Query Cypher per le modifiche recenti di una norma.

        Returns:
            Lista di eventi di modifica ordinati per data DESC (max 5)
        """
        cypher = """
            MATCH (norma {URN: $urn})<-[r:MODIFICA|ABROGA|SOSTITUISCE|INSERISCE]-(modificante)
            RETURN
                type(r) AS event_type,
                modificante.URN AS by_urn,
                modificante.estremi AS by_estremi,
                COALESCE(r.data_efficacia, modificante.data_atto, '') AS event_date
            ORDER BY event_date DESC
            LIMIT 5
        """

        try:
            results = await self.graph_db.ro_query(cypher, {"urn": canonical_urn(urn)})
            return results
        except Exception as e:
            log.error("modifications_query_failed", urn=urn, error=str(e))
            return []

    def _build_validity_result(
        self,
        urn: str,
        node_data: Optional[Dict[str, Any]],
        modifications: List[Dict[str, Any]],
        as_of_date: Optional[str]
    ) -> ValidityResult:
        """
        Costruisce ValidityResult da dati del nodo e modifiche.

        Logic:
        - Se nodo non trovato -> unknown
        - Se sostituito alla data di riferimento (as_of_date o oggi) -> critical
        - Se abrogato alla data di riferimento -> critical
        - Un'abrogazione o sostituzione successiva alla data di riferimento -> pending
        - Se modificato alla data di riferimento (archi MODIFICA o INSERISCE in vigore) -> warning
        - Altrimenti -> vigente, nessun warning
        """
        checked_at = datetime.now(timezone.utc).isoformat()

        # URN not found in graph
        if node_data is None:
            return ValidityResult(
                urn=urn,
                status="unknown",
                is_valid=False,
                warning_level="info",
                warning_message="Stato di vigenza non verificabile per questa norma",
                checked_at=checked_at,
            )

        # Extract node properties. `abrogato` is a flag the seed writes as a string ('false'
        # is truthy): only True or 'true' says abrogated.
        is_abrogated = boolean_flag(node_data.get("is_abrogated")) is True
        mod_count = node_data.get("mod_count") or 0
        last_modified = node_data.get("last_modified")

        abr_urn = node_data.get("abr_urn")
        abr_estremi = node_data.get("abr_estremi")
        abr_date = node_data.get("abr_date")

        sost_urn = node_data.get("sost_urn")
        sost_estremi = node_data.get("sost_estremi")
        sost_date = node_data.get("sost_date")

        # The ends that take effect after the reference date: reported, never the status
        pending = list(node_data.get("pending") or [])
        # An ABROGA or SOSTITUISCE edge, in force or pending, decides: the undated `abrogato`
        # flag counts only for a norm that has none (art. 1632 c.c. carries 'true' and an
        # abrogation of 1971: as at 1960 it was in force).
        if abr_urn or sost_urn or pending:
            is_abrogated = False

        # Build recent modifications list
        recent_mods = []
        for mod in modifications:
            mod_entry = {
                "type": (mod.get("event_type") or "").lower(),
                "by_urn": mod.get("by_urn", ""),
                "by_estremi": mod.get("by_estremi", ""),
                "date": mod.get("event_date", ""),
            }
            recent_mods.append(mod_entry)

        # `mod_count` is already the count as at the reference date (`_count_modifications`)
        relevant_mod_count = mod_count

        # Determine status (priority: sostituito > abrogato > modificato > vigente).
        # `sost_*` and `abr_*` name only an end in force at the reference date (the query
        # decides, against `as_of_date` or today): one that takes effect later is in
        # `pending`, and the norm was still in force at that date.

        if sost_urn:
            replacing_norm = {
                "urn": sost_urn,
                "estremi": sost_estremi or "",
                "date": sost_date or "",
            }
            warning_msg = self._format_warning("sostituito", replacing_norm)
            return ValidityResult(
                urn=urn,
                status="sostituito",
                is_valid=False,
                warning_level="critical",
                warning_message=warning_msg,
                last_modified=str(last_modified) if last_modified else None,
                modification_count=mod_count,
                replacing_norm=replacing_norm,
                recent_modifications=recent_mods,
                checked_at=checked_at,
                pending=pending,
            )

        if is_abrogated or abr_urn:
            abrogating_norm = {
                "urn": abr_urn or "",
                "estremi": abr_estremi or "",
                "date": abr_date or "",
            }
            warning_msg = self._format_warning("abrogato", abrogating_norm)
            return ValidityResult(
                urn=urn,
                status="abrogato",
                is_valid=False,
                warning_level="critical",
                warning_message=warning_msg,
                last_modified=str(last_modified) if last_modified else None,
                modification_count=mod_count,
                abrogating_norm=abrogating_norm,
                recent_modifications=recent_mods,
                checked_at=checked_at,
                pending=pending,
            )

        if relevant_mod_count > 0:
            last_mod_date = str(last_modified) if last_modified else "data non disponibile"
            warning_msg = self._format_warning("modificato", {"date": last_mod_date})
            return ValidityResult(
                urn=urn,
                status="modificato",
                is_valid=True,
                warning_level="warning",
                warning_message=warning_msg,
                last_modified=str(last_modified) if last_modified else None,
                modification_count=mod_count,
                recent_modifications=recent_mods,
                checked_at=checked_at,
                pending=pending,
            )

        # Vigente senza modifiche rilevanti
        return ValidityResult(
            urn=urn,
            status="vigente",
            is_valid=True,
            warning_level="none",
            warning_message=None,
            last_modified=str(last_modified) if last_modified else None,
            modification_count=mod_count,
            recent_modifications=recent_mods,
            checked_at=checked_at,
            pending=pending,
        )

    def _format_warning(self, status: str, details: Dict[str, Any]) -> str:
        """
        Genera messaggio di warning localizzato in italiano.

        Args:
            status: "modificato" | "abrogato" | "sostituito"
            details: Dettagli per il messaggio

        Returns:
            Messaggio formattato
        """
        if status == "modificato":
            date = details.get("date", "data non disponibile")
            return f"Norma modificata (ultima modifica: {date}) - verificare vigenza attuale"

        if status == "abrogato":
            date = details.get("date", "data non disponibile")
            estremi = details.get("estremi", "norma non specificata")
            return f"Norma abrogata il {date} da {estremi}"

        if status == "sostituito":
            date = details.get("date", "data non disponibile")
            estremi = details.get("estremi", "norma non specificata")
            return f"Norma sostituita il {date} da {estremi}"

        return "Stato di vigenza non verificabile per questa norma"

    def build_summary_message(
        self,
        valid_count: int,
        warning_count: int,
        critical_count: int,
        unknown_count: int = 0
    ) -> Optional[str]:
        """
        Genera messaggio di summary aggregato.

        Returns:
            Messaggio banner se ci sono problemi, None se tutto ok
        """
        if critical_count == 0 and warning_count == 0 and unknown_count == 0:
            return None

        parts = []
        if critical_count > 0:
            parts.append(
                f"{critical_count} fonte/i non più in vigore (abrogata/sostituita)"
            )
        if warning_count > 0:
            parts.append(
                f"{warning_count} fonte/i con modifiche recenti"
            )
        if unknown_count > 0:
            parts.append(
                f"{unknown_count} fonte/i con vigenza non verificabile"
            )

        total = valid_count + warning_count + critical_count + unknown_count
        return (
            f"Attenzione: su {total} fonti citate, "
            + "; ".join(parts)
            + ". Verificare la vigenza prima di fare affidamento."
        )

    def clear_cache(self):
        """Pulisce la cache manualmente."""
        self._cache.clear()
        log.info("validity_cache_cleared")
