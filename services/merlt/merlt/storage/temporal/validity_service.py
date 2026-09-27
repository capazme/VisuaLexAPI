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
from datetime import datetime, timezone

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


class TemporalValidityService:
    """
    Service per verifiche di vigenza temporale delle norme.

    Wrappa FalkorDBClient per query Cypher sulle proprietà
    di vigenza dei nodi Norma e sulle relazioni temporali
    (modifica, abroga, sostituisce).

    Note: le relazioni nel grafo FalkorDB usano lowercase
    (abroga, modifica, sostituisce, inserisce) come definito
    in multivigenza.py RELATION_TYPES.

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
        """
        cache_key = f"{urn}:{as_of_date or 'current'}"

        # Check cache (lock protects concurrent access)
        async with self._cache_lock:
            cached = self._cache.get(cache_key)
            if cached:
                result, cached_at = cached
                if time.time() - cached_at < CACHE_TTL_SECONDS:
                    log.debug("validity_cache_hit", urn=urn)
                    return result

        # Query FalkorDB (outside lock — allow concurrent queries)
        node_data = await self._query_norm_status(urn)

        modifications = []
        if node_data and node_data.get("mod_count", 0) > 0:
            modifications = await self._query_modifications(urn)

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

    async def _query_norm_status(self, urn: str) -> Optional[Dict[str, Any]]:
        """
        Query Cypher per ottenere status e proprietà del nodo Norma.

        Returns:
            Dict con proprietà del nodo, o None se non trovato
        """
        cypher = """
            MATCH (norma {URN: $urn})
            OPTIONAL MATCH (norma)<-[r_abr:abroga]-(abrogante)
            OPTIONAL MATCH (norma)<-[r_sost:sostituisce]-(sostituto)
            RETURN
                norma.abrogato AS is_abrogated,
                norma.is_versione_vigente AS is_current,
                norma.n_modifiche AS mod_count,
                norma.ultima_modifica AS last_modified,
                norma.data_inizio_vigenza AS effective_since,
                abrogante.URN AS abr_urn,
                abrogante.estremi AS abr_estremi,
                r_abr.data_efficacia AS abr_date,
                sostituto.URN AS sost_urn,
                sostituto.estremi AS sost_estremi,
                r_sost.data_efficacia AS sost_date
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})
            if not results:
                return None
            return results[0]
        except Exception as e:
            log.error("validity_query_failed", urn=urn, error=str(e))
            return None

    async def _query_modifications(self, urn: str) -> List[Dict[str, Any]]:
        """
        Query Cypher per le modifiche recenti di una norma.

        Returns:
            Lista di eventi di modifica ordinati per data DESC (max 5)
        """
        cypher = """
            MATCH (norma {URN: $urn})<-[r:modifica|abroga|sostituisce]-(modificante)
            RETURN
                type(r) AS event_type,
                modificante.URN AS by_urn,
                modificante.estremi AS by_estremi,
                COALESCE(r.data_efficacia, modificante.data_atto, '') AS event_date
            ORDER BY event_date DESC
            LIMIT 5
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})
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
        - Se sostituito (e sostituzione <= as_of_date o no as_of_date) -> critical
        - Se abrogato (e abrogazione <= as_of_date o no as_of_date) -> critical
        - Se modificato (n_modifiche > 0, post as_of_date) -> warning
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

        # Extract node properties
        is_abrogated = node_data.get("is_abrogated", False)
        mod_count = node_data.get("mod_count") or 0
        last_modified = node_data.get("last_modified")

        abr_urn = node_data.get("abr_urn")
        abr_estremi = node_data.get("abr_estremi")
        abr_date = node_data.get("abr_date")

        sost_urn = node_data.get("sost_urn")
        sost_estremi = node_data.get("sost_estremi")
        sost_date = node_data.get("sost_date")

        # Build recent modifications list
        recent_mods = []
        for mod in modifications:
            mod_entry = {
                "type": mod.get("event_type", ""),
                "by_urn": mod.get("by_urn", ""),
                "by_estremi": mod.get("by_estremi", ""),
                "date": mod.get("event_date", ""),
            }
            recent_mods.append(mod_entry)

        # Filter by as_of_date if provided
        relevant_mod_count = mod_count
        if as_of_date and modifications:
            # Count only modifications AFTER as_of_date
            post_date_mods = [
                m for m in recent_mods
                if m["date"] and m["date"] > as_of_date
            ]
            relevant_mod_count = len(post_date_mods)

        # Determine status (priority: sostituito > abrogato > modificato > vigente)
        # as_of_date logic: if the event happened AFTER as_of_date, the norm
        # was still valid at that date, so skip the event.

        if sost_urn:
            # Sostituzione: report only if happened on or before as_of_date (or no date filter)
            if not as_of_date or not sost_date or sost_date <= as_of_date:
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
                )

        if is_abrogated or abr_urn:
            # Abrogazione: report only if happened on or before as_of_date (or no date filter)
            if not as_of_date or not abr_date or abr_date <= as_of_date:
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
