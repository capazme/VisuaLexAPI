"""
Validation Data Models
======================

Modelli per il sistema di validazione del knowledge graph.
Progettato per integrazione API con frontend React/Vite.

Tutti i modelli hanno metodi `to_dict()` e `to_json()` per serializzazione JSON.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Any, Optional
import json


class IssueSeverity(str, Enum):
    """Livelli di severità per problemi di validazione."""
    CRITICAL = "critical"  # Deve essere risolto, blocca le query
    HIGH = "high"          # Dovrebbe essere risolto, impatta la qualità
    MEDIUM = "medium"      # Utile risolvere, impatto minore
    LOW = "low"            # Informativo


class IssueType(str, Enum):
    """Tipi di problemi di validazione."""
    # Graph validation (da iusgraph)
    DUPLICATE = "duplicate"           # Entità duplicate
    ORPHAN = "orphan"                 # Relazioni/stub orfani
    TEMPORAL = "temporal"             # Violazioni sequenza temporale
    CONTENT = "content"               # Proprietà mancanti, bassa confidence
    COHERENCE = "coherence"           # Mismatch contenuto-tipo
    EMBEDDING = "embedding"           # Embedding mancanti
    ENRICHMENT = "enrichment"         # Gap contenuto vs documento sorgente

    # RLCF-specific
    FEEDBACK_INVALID = "feedback_invalid"      # Feedback non valido
    AUTHORITY_MISMATCH = "authority_mismatch"  # Mismatch autorità fonte


@dataclass
class ValidationIssue:
    """
    Rappresenta un'inconsistenza rilevata nel grafo.

    Attributes:
        issue_id: Identificatore univoco del problema
        issue_type: Tipo di problema (IssueType enum)
        severity: Severità del problema (IssueSeverity enum)
        confidence: Confidenza 0.0-1.0 che sia effettivamente un problema
        description: Descrizione leggibile del problema
        affected_entities: Lista di node_id coinvolti
        affected_relationships: Lista di relationship_id coinvolti
        suggested_fix: Suggerimento per la risoluzione
        auto_fixable: True se confidence >= threshold (default 0.85)
        metadata: Dati aggiuntivi specifici per tipo di problema
    """
    issue_id: str
    issue_type: IssueType
    severity: IssueSeverity
    confidence: float  # 0.0-1.0
    description: str
    affected_entities: List[str]  # node IDs
    affected_relationships: List[str] = field(default_factory=list)
    suggested_fix: Optional[str] = None
    auto_fixable: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione JSON (API response)."""
        return {
            "issue_id": self.issue_id,
            "issue_type": self.issue_type.value,
            "severity": self.severity.value,
            "confidence": self.confidence,
            "description": self.description,
            "affected_entities": self.affected_entities,
            "affected_relationships": self.affected_relationships,
            "suggested_fix": self.suggested_fix,
            "auto_fixable": self.auto_fixable,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ValidationIssue":
        """Crea istanza da dizionario (API request)."""
        return cls(
            issue_id=data["issue_id"],
            issue_type=IssueType(data["issue_type"]),
            severity=IssueSeverity(data["severity"]),
            confidence=data["confidence"],
            description=data["description"],
            affected_entities=data["affected_entities"],
            affected_relationships=data.get("affected_relationships", []),
            suggested_fix=data.get("suggested_fix"),
            auto_fixable=data.get("auto_fixable", False),
            metadata=data.get("metadata", {}),
        )


@dataclass
class FixResult:
    """Risultato dell'applicazione di fix automatici."""
    issues_fixed: int = 0
    issues_skipped: int = 0
    issues_failed: int = 0
    nodes_merged: int = 0
    nodes_deleted: int = 0
    nodes_enriched: int = 0
    relationships_deleted: int = 0
    relationships_created: int = 0
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per API response."""
        return {
            "issues_fixed": self.issues_fixed,
            "issues_skipped": self.issues_skipped,
            "issues_failed": self.issues_failed,
            "nodes_merged": self.nodes_merged,
            "nodes_deleted": self.nodes_deleted,
            "nodes_enriched": self.nodes_enriched,
            "relationships_deleted": self.relationships_deleted,
            "relationships_created": self.relationships_created,
            "errors": self.errors,
        }


@dataclass
class ValidationReport:
    """
    Report completo di validazione.

    Progettato per essere restituito come JSON response da API endpoint.
    """
    timestamp: datetime
    duration_seconds: float
    total_nodes: int
    total_relationships: int
    issues: List[ValidationIssue]
    fix_result: Optional[FixResult] = None

    @property
    def issues_found(self) -> int:
        return len(self.issues)

    @property
    def issues_by_type(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for issue in self.issues:
            key = issue.issue_type.value
            counts[key] = counts.get(key, 0) + 1
        return counts

    @property
    def issues_by_severity(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for issue in self.issues:
            key = issue.severity.value
            counts[key] = counts.get(key, 0) + 1
        return counts

    @property
    def auto_fixable_count(self) -> int:
        return sum(1 for i in self.issues if i.auto_fixable)

    @property
    def requires_review_count(self) -> int:
        return sum(1 for i in self.issues if not i.auto_fixable)

    def to_dict(self) -> Dict[str, Any]:
        """
        Converte in dizionario per API JSON response.

        Returns:
            Dizionario serializzabile JSON con struttura:
            {
                "timestamp": "ISO-8601",
                "summary": {...},
                "issues_by_type": {...},
                "issues_by_severity": {...},
                "issues": [...],
                "fix_result": {...} | null
            }
        """
        return {
            "timestamp": self.timestamp.isoformat(),
            "duration_seconds": self.duration_seconds,
            "summary": {
                "total_nodes": self.total_nodes,
                "total_relationships": self.total_relationships,
                "issues_found": self.issues_found,
                "auto_fixable": self.auto_fixable_count,
                "requires_review": self.requires_review_count,
            },
            "issues_by_type": self.issues_by_type,
            "issues_by_severity": self.issues_by_severity,
            "issues": [i.to_dict() for i in self.issues],
            "fix_result": self.fix_result.to_dict() if self.fix_result else None,
        }

    def to_json(self, indent: int = 2) -> str:
        """Converte in stringa JSON."""
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def to_markdown(self) -> str:
        """
        Genera report in markdown.

        Utile per logging, documentazione, o rendering in frontend.
        """
        lines = [
            "# Report Validazione Grafo",
            "",
            f"**Timestamp:** {self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}",
            f"**Durata:** {self.duration_seconds:.2f} secondi",
            "",
            "## Riepilogo",
            "",
            "| Metrica | Valore |",
            "|---------|--------|",
            f"| Nodi Totali | {self.total_nodes:,} |",
            f"| Relazioni Totali | {self.total_relationships:,} |",
            f"| Problemi Trovati | {self.issues_found} |",
            f"| Auto-Risolvibili | {self.auto_fixable_count} |",
            f"| Da Revisionare | {self.requires_review_count} |",
            "",
        ]

        if self.issues_by_type:
            lines.extend([
                "## Problemi per Tipo",
                "",
                "| Tipo | Conteggio |",
                "|------|-----------|",
            ])
            for issue_type, count in sorted(self.issues_by_type.items()):
                lines.append(f"| {issue_type} | {count} |")
            lines.append("")

        if self.issues_by_severity:
            lines.extend([
                "## Problemi per Severità",
                "",
                "| Severità | Conteggio |",
                "|----------|-----------|",
            ])
            for severity, count in sorted(self.issues_by_severity.items()):
                lines.append(f"| {severity} | {count} |")
            lines.append("")

        if self.issues:
            lines.extend([
                "## Dettaglio Problemi",
                "",
            ])
            for i, issue in enumerate(self.issues[:50], 1):
                auto_tag = "AUTO-FIX" if issue.auto_fixable else "REVIEW"
                lines.extend([
                    f"### [{i}] {issue.issue_type.value.upper()} - {issue.severity.value.upper()} ({auto_tag})",
                    "",
                    f"**Confidenza:** {issue.confidence:.2f}",
                    "",
                    f"**Descrizione:** {issue.description}",
                    "",
                    f"**Entità Coinvolte:** {', '.join(issue.affected_entities[:5])}",
                    "",
                ])
                if issue.suggested_fix:
                    lines.append(f"**Soluzione Suggerita:** {issue.suggested_fix}")
                    lines.append("")

            if len(self.issues) > 50:
                lines.append(f"*... e altri {len(self.issues) - 50} problemi*")
                lines.append("")

        if self.fix_result:
            lines.extend([
                "## Risultati Fix",
                "",
                "| Azione | Conteggio |",
                "|--------|-----------|",
                f"| Problemi Risolti | {self.fix_result.issues_fixed} |",
                f"| Problemi Saltati | {self.fix_result.issues_skipped} |",
                f"| Problemi Falliti | {self.fix_result.issues_failed} |",
                f"| Nodi Uniti | {self.fix_result.nodes_merged} |",
                f"| Nodi Eliminati | {self.fix_result.nodes_deleted} |",
                f"| Relazioni Eliminate | {self.fix_result.relationships_deleted} |",
                "",
            ])
            if self.fix_result.errors:
                lines.extend([
                    "### Errori",
                    "",
                ])
                for error in self.fix_result.errors:
                    lines.append(f"- {error}")
                lines.append("")

        return "\n".join(lines)


@dataclass
class ValidationConfig:
    """
    Configurazione per i check di validazione.

    Può essere passata come JSON da frontend per customizzare i check.
    """
    # Soglie di confidenza
    auto_fix_threshold: float = 0.85  # Auto-fix se confidence >= questa soglia
    low_confidence_threshold: float = 0.70  # Flag per review se < questa soglia

    # Rilevamento duplicati
    semantic_similarity_threshold: float = 0.85  # Per duplicati basati su embedding

    # Check da eseguire (None = tutti)
    enabled_checks: Optional[List[str]] = None

    # Impostazioni LLM (per check ambigui)
    use_llm_for_ambiguous: bool = False
    llm_model: str = "google/gemini-2.5-flash"

    # Limiti
    max_issues_per_check: int = 100
    max_nodes_to_scan: int = 10000

    # Impostazioni enrichment
    expand_pages: int = 0  # Espandi ricerca a N pagine prima/dopo
    fix_page_relationships: bool = True

    def should_run_check(self, check_name: str) -> bool:
        """Verifica se un check specifico deve essere eseguito."""
        if self.enabled_checks is None:
            return True
        return check_name in self.enabled_checks

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per API."""
        return {
            "auto_fix_threshold": self.auto_fix_threshold,
            "low_confidence_threshold": self.low_confidence_threshold,
            "semantic_similarity_threshold": self.semantic_similarity_threshold,
            "enabled_checks": self.enabled_checks,
            "use_llm_for_ambiguous": self.use_llm_for_ambiguous,
            "llm_model": self.llm_model,
            "max_issues_per_check": self.max_issues_per_check,
            "max_nodes_to_scan": self.max_nodes_to_scan,
            "expand_pages": self.expand_pages,
            "fix_page_relationships": self.fix_page_relationships,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ValidationConfig":
        """Crea istanza da dizionario (API request)."""
        return cls(
            auto_fix_threshold=data.get("auto_fix_threshold", 0.85),
            low_confidence_threshold=data.get("low_confidence_threshold", 0.70),
            semantic_similarity_threshold=data.get("semantic_similarity_threshold", 0.85),
            enabled_checks=data.get("enabled_checks"),
            use_llm_for_ambiguous=data.get("use_llm_for_ambiguous", False),
            llm_model=data.get("llm_model", "google/gemini-2.5-flash"),
            max_issues_per_check=data.get("max_issues_per_check", 100),
            max_nodes_to_scan=data.get("max_nodes_to_scan", 10000),
            expand_pages=data.get("expand_pages", 0),
            fix_page_relationships=data.get("fix_page_relationships", True),
        )
