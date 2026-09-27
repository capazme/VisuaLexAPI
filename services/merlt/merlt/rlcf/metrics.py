"""
Metrics Tracker
===============

Tracking centralizzato di chiamate LLM, token, costi e risultati estrazione.
Fornisce export JSON e summary per API.

Progettato per integrazione con frontend React/Vite via endpoint API.

Esempio:
    from merlt.rlcf.metrics import get_metrics

    metrics = get_metrics()

    # Registra chiamata LLM
    metrics.record_llm_call(
        model="google/gemini-2.5-flash",
        tokens_in=1234,
        tokens_out=567,
        cost=0.0023,
        purpose="extraction",
        page=5,
        entities_count=3
    )

    # A fine run
    metrics.print_summary()
    metrics.save_to_json()

    # Per API endpoint
    response = metrics.to_dict()
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)


class MetricsTracker:
    """
    Traccia metriche LLM per un run con export JSON e summary.

    Singleton pattern - usa get_metrics() per ottenere l'istanza globale.
    """

    def __init__(self, run_id: Optional[str] = None):
        """
        Inizializza il tracker.

        Args:
            run_id: ID custom del run. Se non fornito, usa timestamp.
        """
        self.run_id = run_id or datetime.now().strftime("%Y%m%d_%H%M%S")
        self.start_time = datetime.now()
        self._call_counter = 0

        # Tracking per chiamata (verbose)
        self.llm_calls: List[Dict[str, Any]] = []

        # Tracking per documento
        self.documents: List[Dict[str, Any]] = []

        # Tracking enrichment
        self.enrichments: List[Dict[str, Any]] = []

        # Tracking scritture grafo
        self.graph_writes: List[Dict[str, Any]] = []

        logger.info(f"MetricsTracker inizializzato: run_id={self.run_id}")

    def record_llm_call(
        self,
        model: str,
        tokens_in: int,
        tokens_out: int,
        cost: float,
        purpose: str,
        page: Optional[int] = None,
        document: Optional[str] = None,
        entities_count: int = 0,
        relationships_count: int = 0,
        duration_sec: float = 0.0
    ) -> int:
        """
        Registra una singola chiamata API LLM.

        Args:
            model: Nome modello usato
            tokens_in: Token input
            tokens_out: Token output
            cost: Costo in USD
            purpose: "extraction", "enrichment", "answer", etc.
            page: Numero pagina (per extraction)
            document: Nome documento
            entities_count: Numero entità estratte
            relationships_count: Numero relazioni estratte
            duration_sec: Durata chiamata in secondi

        Returns:
            ID chiamata per riferimento
        """
        self._call_counter += 1
        call_id = self._call_counter

        call_data = {
            "call_id": call_id,
            "timestamp": datetime.now().isoformat(),
            "model": model,
            "purpose": purpose,
            "document": document,
            "page": page,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost,
            "entities": entities_count,
            "relationships": relationships_count,
            "duration_sec": duration_sec
        }
        self.llm_calls.append(call_data)

        logger.debug(
            f"LLM #{call_id:3d} | {purpose:12s} | "
            f"page {page or '-':>3} | "
            f"${cost:.4f} | "
            f"{tokens_in:,} in / {tokens_out:,} out | "
            f"{entities_count} ent, {relationships_count} rel | "
            f"{duration_sec:.2f}s"
        )

        return call_id

    def record_enrichment(
        self,
        entity_type: str,
        entity_label: str,
        success: bool,
        old_key: Optional[str] = None,
        new_key: Optional[str] = None,
        model: Optional[str] = None
    ):
        """
        Registra un tentativo di enrichment canonical key.

        Args:
            entity_type: Tipo di entità arricchita
            entity_label: Label dell'entità
            success: Se l'enrichment è riuscito
            old_key: Canonical key originale
            new_key: Nuovo canonical key arricchito
            model: Modello usato per enrichment
        """
        enrichment_data = {
            "timestamp": datetime.now().isoformat(),
            "entity_type": entity_type,
            "entity_label": entity_label[:50],
            "success": success,
            "old_key": old_key,
            "new_key": new_key,
            "model": model
        }
        self.enrichments.append(enrichment_data)

        if success:
            logger.debug(
                f"Enriched {entity_type}: '{entity_label[:40]}' → '{new_key}'"
            )
        else:
            logger.debug(
                f"Enrichment failed for {entity_type}: '{entity_label[:40]}'"
            )

    def record_document(
        self,
        document_name: str,
        pages: int,
        segments: int,
        entities: int,
        relationships: int,
        duration_sec: float
    ):
        """
        Registra stats di processing documento.

        Args:
            document_name: Nome documento processato
            pages: Numero pagine nel documento
            segments: Numero segmenti processati
            entities: Totale entità estratte
            relationships: Totale relazioni estratte
            duration_sec: Durata processing
        """
        doc_data = {
            "timestamp": datetime.now().isoformat(),
            "document": document_name,
            "pages": pages,
            "segments": segments,
            "entities": entities,
            "relationships": relationships,
            "duration_sec": duration_sec
        }
        self.documents.append(doc_data)

        logger.info(
            f"Documento: {document_name} | "
            f"{pages} pagine, {segments} segmenti | "
            f"{entities} entità, {relationships} rel | "
            f"{duration_sec:.1f}s"
        )

    def record_graph_write(
        self,
        entities_attempted: int,
        nodes_created: int,
        nodes_updated: int,
        relationships_created: int,
        errors: int
    ):
        """
        Registra stats operazione scrittura grafo.

        Args:
            entities_attempted: Numero entità da scrivere
            nodes_created: Nodi creati
            nodes_updated: Nodi aggiornati (merge)
            relationships_created: Relazioni create
            errors: Numero errori
        """
        write_data = {
            "timestamp": datetime.now().isoformat(),
            "entities_attempted": entities_attempted,
            "nodes_created": nodes_created,
            "nodes_updated": nodes_updated,
            "relationships_created": relationships_created,
            "errors": errors
        }
        self.graph_writes.append(write_data)

    def _compute_summary(self) -> Dict[str, Any]:
        """Calcola statistiche aggregate."""
        total_tokens_in = sum(c["tokens_in"] for c in self.llm_calls)
        total_tokens_out = sum(c["tokens_out"] for c in self.llm_calls)
        total_cost = sum(c["cost_usd"] for c in self.llm_calls)
        total_entities = sum(c["entities"] for c in self.llm_calls)
        total_relationships = sum(c["relationships"] for c in self.llm_calls)

        # Breakdown per purpose
        by_purpose: Dict[str, Dict[str, Any]] = {}
        for call in self.llm_calls:
            purpose = call["purpose"]
            if purpose not in by_purpose:
                by_purpose[purpose] = {
                    "calls": 0,
                    "tokens_in": 0,
                    "tokens_out": 0,
                    "cost_usd": 0.0
                }
            by_purpose[purpose]["calls"] += 1
            by_purpose[purpose]["tokens_in"] += call["tokens_in"]
            by_purpose[purpose]["tokens_out"] += call["tokens_out"]
            by_purpose[purpose]["cost_usd"] += call["cost_usd"]

        # Totali grafo
        graph_nodes_created = sum(w["nodes_created"] for w in self.graph_writes)
        graph_nodes_updated = sum(w["nodes_updated"] for w in self.graph_writes)
        graph_rels_created = sum(w["relationships_created"] for w in self.graph_writes)
        graph_errors = sum(w["errors"] for w in self.graph_writes)

        # Stats enrichment
        enrichments_succeeded = sum(1 for e in self.enrichments if e["success"])

        return {
            "total_llm_calls": len(self.llm_calls),
            "total_tokens_in": total_tokens_in,
            "total_tokens_out": total_tokens_out,
            "total_cost_usd": total_cost,
            "total_entities_extracted": total_entities,
            "total_relationships_extracted": total_relationships,
            "by_purpose": by_purpose,
            "documents_processed": len(self.documents),
            "enrichments_attempted": len(self.enrichments),
            "enrichments_succeeded": enrichments_succeeded,
            "graph_nodes_created": graph_nodes_created,
            "graph_nodes_updated": graph_nodes_updated,
            "graph_relationships_created": graph_rels_created,
            "graph_errors": graph_errors
        }

    def to_dict(self) -> Dict[str, Any]:
        """
        Converte tutte le metriche in dizionario per API response.

        Returns:
            Dizionario JSON-serializzabile con struttura completa metriche
        """
        end_time = datetime.now()

        return {
            "run_id": self.run_id,
            "start_time": self.start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "duration_sec": (end_time - self.start_time).total_seconds(),
            "summary": self._compute_summary(),
            "llm_calls": self.llm_calls,
            "documents": self.documents,
            "enrichments": self.enrichments,
            "graph_writes": self.graph_writes
        }

    def save_to_json(self, output_dir: Optional[Path] = None) -> Path:
        """
        Salva tutte le metriche in file JSON.

        Args:
            output_dir: Directory per output. Default: logs/metrics/

        Returns:
            Path al file JSON salvato
        """
        if output_dir is None:
            output_dir = Path("logs/metrics")
        output_dir.mkdir(parents=True, exist_ok=True)

        output_file = output_dir / f"run_{self.run_id}.json"

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(self.to_dict(), f, indent=2, ensure_ascii=False)

        logger.info(f"Metriche salvate in: {output_file}")
        return output_file

    def print_summary(self):
        """Stampa summary dettagliato a console."""
        s = self._compute_summary()
        duration = (datetime.now() - self.start_time).total_seconds()

        print(f"\n{'═'*70}")
        print(f"RUN SUMMARY - {self.run_id}")
        print(f"{'═'*70}")

        # LLM Calls breakdown per purpose
        print(f"\nLLM CALLS ({s['total_llm_calls']} totali)")
        print(f"   {'─'*50}")
        for purpose, stats in s["by_purpose"].items():
            print(
                f"   {purpose:15s}: {stats['calls']:3d} chiamate | "
                f"${stats['cost_usd']:.4f} | "
                f"{stats['tokens_in']:,} in / {stats['tokens_out']:,} out"
            )

        # Totali
        print(f"\nTOTALI")
        print(f"   Token: {s['total_tokens_in']:,} in / {s['total_tokens_out']:,} out")
        print(f"   Costo: ${s['total_cost_usd']:.4f}")
        print(f"   Entità estratte: {s['total_entities_extracted']}")
        print(f"   Relazioni estratte: {s['total_relationships_extracted']}")

        # Documenti
        if self.documents:
            print(f"\nDOCUMENTI ({s['documents_processed']})")
            for doc in self.documents:
                print(
                    f"   {doc['document'][:40]:40s} | "
                    f"{doc['segments']:3d} seg | "
                    f"{doc['entities']:3d} ent | "
                    f"{doc['duration_sec']:.1f}s"
                )

        # Enrichments
        if s['enrichments_attempted'] > 0:
            pct = s['enrichments_succeeded'] / s['enrichments_attempted'] * 100
            print(f"\nENRICHMENTS")
            print(
                f"   {s['enrichments_succeeded']}/{s['enrichments_attempted']} "
                f"riusciti ({pct:.0f}%)"
            )

        # Graph
        if self.graph_writes:
            print(f"\nGRAPH")
            print(f"   Nodi creati: {s['graph_nodes_created']}")
            print(f"   Nodi aggiornati: {s['graph_nodes_updated']}")
            print(f"   Relazioni: {s['graph_relationships_created']}")
            if s['graph_errors'] > 0:
                print(f"   Errori: {s['graph_errors']}")

        # Durata
        print(f"\nDurata: {duration/60:.1f} min ({duration:.0f}s)")
        print(f"{'═'*70}\n")

    def reset(self):
        """Reset tutte le metriche per un nuovo run."""
        self.run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.start_time = datetime.now()
        self._call_counter = 0
        self.llm_calls = []
        self.documents = []
        self.enrichments = []
        self.graph_writes = []
        logger.info(f"MetricsTracker reset: nuovo run_id={self.run_id}")


# Global singleton instance
_global_metrics: Optional[MetricsTracker] = None


def get_metrics() -> MetricsTracker:
    """
    Ottiene istanza globale del metrics tracker (singleton).

    Returns:
        Istanza MetricsTracker
    """
    global _global_metrics
    if _global_metrics is None:
        _global_metrics = MetricsTracker()
    return _global_metrics


def reset_metrics() -> MetricsTracker:
    """
    Reset del metrics tracker globale per un nuovo run.

    Returns:
        Istanza MetricsTracker resettata
    """
    global _global_metrics
    if _global_metrics:
        _global_metrics.reset()
    else:
        _global_metrics = MetricsTracker()
    return _global_metrics
