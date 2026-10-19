"""
Bridge Table Builder
====================

Helper to convert IngestionPipelineV2 BridgeMappings into
Bridge Table format and insert them.

Usage:
    from merlt.pipeline import IngestionPipelineV2
    from merlt.storage.bridge import BridgeTable, BridgeBuilder

    # Ingest article
    pipeline = IngestionPipelineV2(falkordb_client)
    result = await pipeline.ingest_article(article)

    # Insert bridge mappings
    builder = BridgeBuilder(bridge_table)
    inserted = await builder.insert_mappings(result.bridge_mappings)
"""

import structlog
from typing import List, Dict, Any, Optional

from merlt.storage.bridge.bridge_table import BridgeTable
from merlt.models import BridgeMapping

log = structlog.get_logger()


class BridgeBuilder:
    """
    Builder for inserting Bridge Table mappings from ingestion pipeline.

    Converts BridgeMapping objects to the format required by BridgeTable
    and handles batch insertion.
    """

    # Mapping type to node_type conversion
    MAPPING_TYPE_TO_NODE_TYPE = {
        "PRIMARY": "Norma",
        "HIERARCHIC": "Norma",
        "CONCEPT": "ConcettoGiuridico",
        "REFERENCE": "Norma",
        "DOCTRINE": "Dottrina",
        "JURISPRUDENCE": "AttoGiudiziario",
    }

    # Mapping type to relation_type conversion
    MAPPING_TYPE_TO_RELATION = {
        "PRIMARY": "contained_in",
        "HIERARCHIC": "part_of",
        "CONCEPT": "relates_to",
        "REFERENCE": "references",
        "DOCTRINE": "commented_by",
        "JURISPRUDENCE": "interpreted_by",
    }

    def __init__(self, bridge_table: BridgeTable):
        """
        Initialize builder with Bridge Table instance.

        Args:
            bridge_table: Connected BridgeTable instance
        """
        self.bridge = bridge_table
        log.info("BridgeBuilder initialized")

    def convert_mapping(self, mapping: BridgeMapping) -> Dict[str, Any]:
        """
        Convert a BridgeMapping to Bridge Table format.

        Args:
            mapping: BridgeMapping from ingestion pipeline

        Returns:
            Dict ready for add_mapping() or add_mappings_batch()
        """
        return {
            "chunk_id": mapping.chunk_id,
            "graph_node_urn": mapping.graph_node_urn,
            "node_type": self.MAPPING_TYPE_TO_NODE_TYPE.get(
                mapping.mapping_type, "Unknown"
            ),
            "relation_type": self.MAPPING_TYPE_TO_RELATION.get(
                mapping.mapping_type, "unknown"
            ),
            "confidence": mapping.confidence,
            "chunk_text": mapping.chunk_text,  # Testo del chunk per debug/RAG
            "source": "ingestion_v2",
            "metadata": mapping.metadata,
        }

    def convert_batch(self, mappings: List[BridgeMapping]) -> List[Dict[str, Any]]:
        """
        Convert multiple BridgeMappings to Bridge Table format.

        Args:
            mappings: List of BridgeMapping objects

        Returns:
            List of dicts ready for add_mappings_batch()
        """
        return [self.convert_mapping(m) for m in mappings]

    async def insert_mapping(self, mapping: BridgeMapping) -> int:
        """
        Insert a single mapping into Bridge Table.

        Args:
            mapping: BridgeMapping from ingestion pipeline

        Returns:
            ID of inserted entry
        """
        converted = self.convert_mapping(mapping)
        entry_id = await self.bridge.add_mapping(**converted)
        log.debug(f"Inserted mapping: {entry_id}")
        return entry_id

    async def insert_mappings(
        self,
        mappings: List[BridgeMapping],
        batch_size: int = 100
    ) -> int:
        """
        Insert multiple mappings in batches.

        Args:
            mappings: List of BridgeMapping objects
            batch_size: Number of mappings per batch (default 100)

        Returns:
            Total number of mappings inserted
        """
        if not mappings:
            return 0

        converted = self.convert_batch(mappings)
        total_inserted = 0

        # Insert in batches
        for i in range(0, len(converted), batch_size):
            batch = converted[i:i + batch_size]
            inserted = await self.bridge.add_mappings_batch(batch)
            total_inserted += inserted
            log.info(
                f"Inserted batch {i // batch_size + 1}: "
                f"{inserted} mappings"
            )

        log.info(f"Total mappings inserted: {total_inserted}")
        return total_inserted


async def insert_ingestion_result(
    bridge_table: BridgeTable,
    bridge_mappings: List[BridgeMapping],
) -> int:
    """
    Convenience function to insert ingestion result mappings.

    Args:
        bridge_table: Connected BridgeTable instance
        bridge_mappings: List of BridgeMapping from IngestionResult

    Returns:
        Number of mappings inserted
    """
    builder = BridgeBuilder(bridge_table)
    return await builder.insert_mappings(bridge_mappings)


__all__ = [
    "BridgeBuilder",
    "insert_ingestion_result",
]
