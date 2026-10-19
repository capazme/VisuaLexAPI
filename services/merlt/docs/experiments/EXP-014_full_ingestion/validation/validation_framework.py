#!/usr/bin/env python3
"""
Framework di Validazione per Full Ingestion
============================================

Validazione rigorosa per backbone e enrichment ingestion.
Esegue controlli di integrità, qualità e completezza dei dati.

Usage:
    python validation_framework.py --phase backbone
    python validation_framework.py --phase enrichment
    python validation_framework.py --phase all
"""

import asyncio
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add project root
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent))


class ValidationStatus(Enum):
    """Stato della validazione."""
    PASS = "PASS"
    FAIL = "FAIL"
    WARN = "WARN"
    SKIP = "SKIP"


@dataclass
class ValidationCheck:
    """Singolo check di validazione."""
    name: str
    description: str
    status: ValidationStatus
    expected: Any
    actual: Any
    message: str = ""

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "description": self.description,
            "status": self.status.value,
            "expected": self.expected,
            "actual": self.actual,
            "message": self.message
        }


@dataclass
class ValidationResult:
    """Risultato complessivo della validazione."""
    phase: str
    timestamp: str
    checks: List[ValidationCheck] = field(default_factory=list)
    summary: Dict[str, int] = field(default_factory=dict)

    def add_check(self, check: ValidationCheck):
        self.checks.append(check)

    def compute_summary(self):
        self.summary = {
            "total": len(self.checks),
            "passed": sum(1 for c in self.checks if c.status == ValidationStatus.PASS),
            "failed": sum(1 for c in self.checks if c.status == ValidationStatus.FAIL),
            "warnings": sum(1 for c in self.checks if c.status == ValidationStatus.WARN),
            "skipped": sum(1 for c in self.checks if c.status == ValidationStatus.SKIP),
        }

    def to_dict(self) -> Dict:
        self.compute_summary()
        return {
            "phase": self.phase,
            "timestamp": self.timestamp,
            "summary": self.summary,
            "checks": [c.to_dict() for c in self.checks]
        }

    def print_report(self):
        """Stampa report formattato."""
        self.compute_summary()

        print()
        print("=" * 70)
        print(f"VALIDATION REPORT: {self.phase.upper()}")
        print(f"Timestamp: {self.timestamp}")
        print("=" * 70)

        # Summary
        print(f"\nSummary: {self.summary['passed']}/{self.summary['total']} passed")
        if self.summary['failed'] > 0:
            print(f"  ❌ {self.summary['failed']} FAILED")
        if self.summary['warnings'] > 0:
            print(f"  ⚠️  {self.summary['warnings']} WARNINGS")

        # Details
        print("\nDetails:")
        print("-" * 70)

        for check in self.checks:
            icon = {
                ValidationStatus.PASS: "✅",
                ValidationStatus.FAIL: "❌",
                ValidationStatus.WARN: "⚠️",
                ValidationStatus.SKIP: "⏭️"
            }[check.status]

            print(f"{icon} {check.name}")
            print(f"   {check.description}")
            print(f"   Expected: {check.expected}, Actual: {check.actual}")
            if check.message:
                print(f"   Message: {check.message}")
            print()


class BackboneValidator:
    """Validatore per backbone ingestion."""

    def __init__(self):
        self.result = ValidationResult(
            phase="backbone",
            timestamp=datetime.now().isoformat()
        )

    async def validate(self) -> ValidationResult:
        """Esegue tutte le validazioni backbone."""
        from merlt.storage.graph import FalkorDBClient

        client = FalkorDBClient()
        await client.connect()

        try:
            await self._check_article_count(client)
            await self._check_comma_count(client)
            await self._check_rubrica_not_in_comma(client)
            await self._check_rubrica_on_norma(client)
            await self._check_contiene_relations(client)
            await self._check_comma_numbering(client)
            await self._check_urn_format(client)
        finally:
            await client.close()

        return self.result

    async def _check_article_count(self, client):
        """Verifica numero articoli ingeriti."""
        result = await client.query("""
            MATCH (n:Norma)
            WHERE n.numero_articolo IS NOT NULL
            RETURN count(n) as cnt
        """)
        actual = result[0]["cnt"] if result else 0
        expected = 887  # Libro IV CC

        self.result.add_check(ValidationCheck(
            name="article_count",
            description="Numero articoli ingeriti (Libro IV CC)",
            status=ValidationStatus.PASS if actual == expected else ValidationStatus.FAIL,
            expected=expected,
            actual=actual,
            message="" if actual == expected else f"Differenza: {actual - expected}"
        ))

    async def _check_comma_count(self, client):
        """Verifica numero commi creati."""
        result = await client.query("""
            MATCH (c:Comma)
            RETURN count(c) as cnt
        """)
        actual = result[0]["cnt"] if result else 0
        expected_min = 1500  # Stima conservativa
        expected_max = 3000

        status = ValidationStatus.PASS if expected_min <= actual <= expected_max else ValidationStatus.WARN

        self.result.add_check(ValidationCheck(
            name="comma_count",
            description="Numero commi creati",
            status=status,
            expected=f"{expected_min}-{expected_max}",
            actual=actual
        ))

    async def _check_rubrica_not_in_comma(self, client):
        """Verifica che nessun comma contenga rubrica come testo."""
        result = await client.query("""
            MATCH (c:Comma)
            WHERE c.numero = 1 AND c.testo STARTS WITH '('
            RETURN count(c) as cnt
        """)
        actual = result[0]["cnt"] if result else 0
        expected = 0

        self.result.add_check(ValidationCheck(
            name="rubrica_not_in_comma",
            description="Commi con rubrica come testo (bug fix verification)",
            status=ValidationStatus.PASS if actual == expected else ValidationStatus.FAIL,
            expected=expected,
            actual=actual,
            message="BUG: Rubriche erroneamente salvate come comma 1" if actual > 0 else ""
        ))

    async def _check_rubrica_on_norma(self, client):
        """Verifica che le rubriche siano salvate sui nodi Norma."""
        result = await client.query("""
            MATCH (n:Norma)
            WHERE n.numero_articolo IS NOT NULL
            RETURN
                count(n) as total,
                count(CASE WHEN n.rubrica IS NOT NULL AND n.rubrica <> '' THEN 1 END) as with_rubrica
        """)
        total = result[0]["total"] if result else 0
        with_rubrica = result[0]["with_rubrica"] if result else 0

        percentage = (with_rubrica / total * 100) if total > 0 else 0
        expected_percentage = 90  # >90% articoli dovrebbero avere rubrica

        self.result.add_check(ValidationCheck(
            name="rubrica_on_norma",
            description="Articoli con rubrica salvata (>90% expected)",
            status=ValidationStatus.PASS if percentage >= expected_percentage else ValidationStatus.WARN,
            expected=f">{expected_percentage}%",
            actual=f"{percentage:.1f}% ({with_rubrica}/{total})"
        ))

    async def _check_contiene_relations(self, client):
        """Verifica relazioni contiene (Norma → Comma)."""
        result = await client.query("""
            MATCH (c:Comma)
            RETURN count(c) as comma_count
        """)
        comma_count = result[0]["comma_count"] if result else 0

        result2 = await client.query("""
            MATCH ()-[r:contiene]->(:Comma)
            RETURN count(r) as rel_count
        """)
        rel_count = result2[0]["rel_count"] if result2 else 0

        self.result.add_check(ValidationCheck(
            name="contiene_relations",
            description="Relazioni contiene = numero commi",
            status=ValidationStatus.PASS if comma_count == rel_count else ValidationStatus.FAIL,
            expected=comma_count,
            actual=rel_count,
            message="Ogni comma deve avere una relazione contiene" if comma_count != rel_count else ""
        ))

    async def _check_comma_numbering(self, client):
        """Verifica numerazione commi consecutiva per ogni articolo."""
        result = await client.query("""
            MATCH (n:Norma)-[:contiene]->(c:Comma)
            WHERE n.numero_articolo IS NOT NULL
            WITH n, c ORDER BY c.numero
            WITH n, collect(c.numero) as numeri
            WHERE size(numeri) > 0 AND numeri[0] <> 1
            RETURN count(n) as bad_articles
        """)
        bad_articles = result[0]["bad_articles"] if result else 0

        self.result.add_check(ValidationCheck(
            name="comma_numbering",
            description="Articoli con numerazione commi che non parte da 1",
            status=ValidationStatus.PASS if bad_articles == 0 else ValidationStatus.FAIL,
            expected=0,
            actual=bad_articles
        ))

    async def _check_urn_format(self, client):
        """Verifica formato URN corretto."""
        result = await client.query("""
            MATCH (c:Comma)
            WHERE NOT c.URN CONTAINS '~art'
            RETURN count(c) as bad_urn
        """)
        bad_urn = result[0]["bad_urn"] if result else 0

        self.result.add_check(ValidationCheck(
            name="urn_format",
            description="Commi con URN formato corretto (contiene ~art)",
            status=ValidationStatus.PASS if bad_urn == 0 else ValidationStatus.WARN,
            expected=0,
            actual=bad_urn
        ))


class EnrichmentValidator:
    """Validatore per enrichment."""

    def __init__(self):
        self.result = ValidationResult(
            phase="enrichment",
            timestamp=datetime.now().isoformat()
        )

    async def validate(self) -> ValidationResult:
        """Esegue tutte le validazioni enrichment."""
        from merlt.storage.graph import FalkorDBClient

        client = FalkorDBClient()
        await client.connect()

        try:
            await self._check_entity_types_extracted(client)
            await self._check_relations_for_entities(client)
            await self._check_no_orphan_entities(client)
            await self._check_entity_properties(client)
        finally:
            await client.close()

        return self.result

    async def _check_entity_types_extracted(self, client):
        """Verifica estrazione di tutti i tipi di entità."""
        entity_labels = [
            "ConcettoGiuridico", "PrincipioGiuridico", "DefinizioneLegale",
            "SoggettoGiuridico", "Ruolo", "ModalitaGiuridica", "FattoGiuridico",
            "AttoGiuridico", "Procedura", "Termine", "EffettoGiuridico",
            "Responsabilita", "Rimedio", "Sanzione", "Caso", "Eccezione", "Clausola"
        ]

        for label in entity_labels:
            result = await client.query(f"""
                MATCH (e:{label})
                WHERE e.schema_version = '2.1'
                RETURN count(e) as cnt
            """)
            count = result[0]["cnt"] if result else 0

            # I primi 3 tipi sono più comuni, gli altri potrebbero essere 0
            expected_min = 1 if label in ["ConcettoGiuridico", "PrincipioGiuridico", "DefinizioneLegale"] else 0

            self.result.add_check(ValidationCheck(
                name=f"entity_type_{label}",
                description=f"Entità di tipo {label} estratte",
                status=ValidationStatus.PASS if count >= expected_min else ValidationStatus.WARN,
                expected=f">={expected_min}",
                actual=count
            ))

    async def _check_relations_for_entities(self, client):
        """Verifica creazione relazioni per entità."""
        # Mapping da entity type a relation type
        relations_mapping = {
            "ConcettoGiuridico": "DISCIPLINA",
            "PrincipioGiuridico": "ESPRIME_PRINCIPIO",
            "DefinizioneLegale": "DEFINISCE",
            "SoggettoGiuridico": "APPLICA_A",
            "ModalitaGiuridica": "IMPONE",
            "Procedura": "PREVEDE",
            "Termine": "STABILISCE_TERMINE",
            "Sanzione": "PREVEDE_SANZIONE",
            "Responsabilita": "ATTRIBUISCE_RESPONSABILITA"
        }

        for entity_label, rel_type in relations_mapping.items():
            # Conta entità
            entity_result = await client.query(f"""
                MATCH (e:{entity_label})
                WHERE e.schema_version = '2.1'
                RETURN count(e) as cnt
            """)
            entity_count = entity_result[0]["cnt"] if entity_result else 0

            if entity_count == 0:
                continue  # Skip se nessuna entità di questo tipo

            # Conta relazioni
            rel_result = await client.query(f"""
                MATCH (:Norma)-[r:{rel_type}]->()
                RETURN count(r) as cnt
            """)
            rel_count = rel_result[0]["cnt"] if rel_result else 0

            self.result.add_check(ValidationCheck(
                name=f"relation_{rel_type}",
                description=f"Relazioni {rel_type} per {entity_label}",
                status=ValidationStatus.PASS if rel_count > 0 else ValidationStatus.WARN,
                expected=f">0 (entities: {entity_count})",
                actual=rel_count
            ))

    async def _check_no_orphan_entities(self, client):
        """Verifica che non ci siano entità senza relazioni."""
        result = await client.query("""
            MATCH (e)
            WHERE e.schema_version = '2.1'
              AND NOT (e)<-[:DISCIPLINA|ESPRIME_PRINCIPIO|DEFINISCE|APPLICA_A|IMPONE|PREVEDE|STABILISCE_TERMINE|PREVEDE_SANZIONE|ATTRIBUISCE_RESPONSABILITA]-()
            RETURN labels(e)[0] as label, count(e) as cnt
        """)

        orphans = {r["label"]: r["cnt"] for r in result if r["cnt"] > 0}
        total_orphans = sum(orphans.values())

        self.result.add_check(ValidationCheck(
            name="no_orphan_entities",
            description="Entità senza relazioni con Norma",
            status=ValidationStatus.PASS if total_orphans == 0 else ValidationStatus.WARN,
            expected=0,
            actual=total_orphans,
            message=str(orphans) if orphans else ""
        ))

    async def _check_entity_properties(self, client):
        """Verifica proprietà obbligatorie sulle entità."""
        result = await client.query("""
            MATCH (e)
            WHERE e.schema_version = '2.1'
              AND (e.nome IS NULL OR e.nome = '')
            RETURN count(e) as cnt
        """)
        no_name = result[0]["cnt"] if result else 0

        self.result.add_check(ValidationCheck(
            name="entity_has_name",
            description="Entità con proprietà 'nome' valorizzata",
            status=ValidationStatus.PASS if no_name == 0 else ValidationStatus.FAIL,
            expected=0,
            actual=no_name,
            message="Tutte le entità devono avere un nome"
        ))


async def run_validation(phase: str):
    """Esegue validazione per la fase specificata."""
    results = []

    if phase in ["backbone", "all"]:
        print("\n🔍 Validating BACKBONE...")
        validator = BackboneValidator()
        result = await validator.validate()
        result.print_report()
        results.append(result)

        # Save results
        output_path = Path(__file__).parent / "backbone_validation.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result.to_dict(), f, indent=2, ensure_ascii=False)
        print(f"\n📄 Results saved to: {output_path}")

    if phase in ["enrichment", "all"]:
        print("\n🔍 Validating ENRICHMENT...")
        validator = EnrichmentValidator()
        result = await validator.validate()
        result.print_report()
        results.append(result)

        # Save results
        output_path = Path(__file__).parent / "enrichment_validation.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result.to_dict(), f, indent=2, ensure_ascii=False)
        print(f"\n📄 Results saved to: {output_path}")

    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Validation Framework for Full Ingestion")
    parser.add_argument("--phase", choices=["backbone", "enrichment", "all"], default="all",
                       help="Phase to validate")

    args = parser.parse_args()
    asyncio.run(run_validation(args.phase))
