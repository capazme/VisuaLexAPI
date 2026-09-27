-- Bridge Table Schema
-- =====================
-- Maps vector embeddings (Qdrant) to graph nodes (FalkorDB)
--
-- Use Case:
--   When retrieving chunks from Qdrant, use this table to:
--   1. Find related graph nodes
--   2. Enrich results with graph context
--   3. Enable hybrid scoring (vector + graph)
--
-- Design:
--   - Many-to-many: One chunk can reference multiple nodes
--   - Bidirectional: Can query by chunk_id OR graph_node_urn
--   - Typed: node_type for filtering by entity type
--   - Scored: confidence for ranking

CREATE TABLE IF NOT EXISTS bridge_table (
    id SERIAL PRIMARY KEY,

    -- Qdrant side (vector embeddings)
    chunk_id UUID NOT NULL,
    chunk_text TEXT,  -- Cached for debugging

    -- FalkorDB side (graph nodes)
    graph_node_urn VARCHAR(500) NOT NULL,
    node_type VARCHAR(50) NOT NULL,  -- Norma, ConcettoGiuridico, Dottrina, AttoGiudiziario

    -- Relation metadata
    relation_type VARCHAR(50),  -- contained_in, references, cites, etc.
    confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),

    -- Provenance
    source VARCHAR(100),  -- visualex, manual, llm_extraction
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Additional metadata (JSONB for flexibility)
    metadata JSONB,

    -- Constraints
    UNIQUE(chunk_id, graph_node_urn)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_bridge_chunk_id ON bridge_table(chunk_id);
CREATE INDEX IF NOT EXISTS idx_bridge_graph_node ON bridge_table(graph_node_urn);
CREATE INDEX IF NOT EXISTS idx_bridge_node_type ON bridge_table(node_type);
CREATE INDEX IF NOT EXISTS idx_bridge_relation_type ON bridge_table(relation_type);
CREATE INDEX IF NOT EXISTS idx_bridge_confidence ON bridge_table(confidence);

-- Composite index for hybrid queries
CREATE INDEX IF NOT EXISTS idx_bridge_chunk_node ON bridge_table(chunk_id, graph_node_urn);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_bridge_table_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_bridge_table_updated_at
    BEFORE UPDATE ON bridge_table
    FOR EACH ROW
    EXECUTE FUNCTION update_bridge_table_updated_at();

-- Comments for documentation
COMMENT ON TABLE bridge_table IS 'Maps vector embeddings (Qdrant chunk_id) to graph nodes (FalkorDB URN)';
COMMENT ON COLUMN bridge_table.chunk_id IS 'UUID of the text chunk in Qdrant vector store';
COMMENT ON COLUMN bridge_table.graph_node_urn IS 'URN of the related node in FalkorDB graph';
COMMENT ON COLUMN bridge_table.node_type IS 'Type of graph node: Norma, ConcettoGiuridico, Dottrina, AttoGiudiziario';
COMMENT ON COLUMN bridge_table.relation_type IS 'Semantic relation: contained_in, references, cites, interprets, etc.';
COMMENT ON COLUMN bridge_table.confidence IS 'Confidence score [0-1] for this mapping';
