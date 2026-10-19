-- Trace Storage Schema
-- ====================
--
-- DDL for qa_traces and qa_feedback tables.
-- Compatible with PostgreSQL 13+.
--
-- Usage:
--     psql -h localhost -p 5433 -U dev -d rlcf_dev -f schema.sql

-- qa_traces: Pipeline execution traces
CREATE TABLE IF NOT EXISTS qa_traces (
    trace_id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    query TEXT NOT NULL,
    selected_experts VARCHAR(100)[],
    synthesis_mode VARCHAR(20),
    synthesis_text TEXT,
    sources JSONB,
    execution_time_ms INTEGER,
    full_trace JSONB,

    -- Consent-aware storage (Story 5-1)
    consent_level VARCHAR(20) NOT NULL DEFAULT 'basic',
    query_type VARCHAR(50),
    confidence FLOAT,
    routing_method VARCHAR(30),

    -- Archival
    is_archived BOOLEAN NOT NULL DEFAULT false,
    archived_at TIMESTAMP,

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT chk_synthesis_mode CHECK (
        synthesis_mode IS NULL OR synthesis_mode IN ('convergent', 'divergent')
    ),
    CONSTRAINT chk_consent_level CHECK (
        consent_level IN ('anonymous', 'basic', 'full')
    ),
    CONSTRAINT chk_confidence CHECK (
        confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
    )
);

-- Indices for qa_traces
CREATE INDEX IF NOT EXISTS idx_qa_traces_user ON qa_traces(user_id);
CREATE INDEX IF NOT EXISTS idx_qa_traces_created ON qa_traces(created_at);
CREATE INDEX IF NOT EXISTS idx_qa_traces_user_created ON qa_traces(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_qa_traces_query_type ON qa_traces(query_type);
CREATE INDEX IF NOT EXISTS idx_qa_traces_archived ON qa_traces(is_archived);
CREATE INDEX IF NOT EXISTS idx_qa_traces_consent ON qa_traces(consent_level);


-- qa_feedback: Multi-level feedback for traces
CREATE TABLE IF NOT EXISTS qa_feedback (
    id SERIAL PRIMARY KEY,
    trace_id VARCHAR(50) NOT NULL REFERENCES qa_traces(trace_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL,

    -- Type 1: Inline rating (quick thumbs)
    inline_rating INTEGER,

    -- Type 2: Detailed form (3 dimensions)
    retrieval_score FLOAT,
    reasoning_score FLOAT,
    synthesis_score FLOAT,
    detailed_comment TEXT,

    -- Type 3: Per-source rating
    source_id VARCHAR(200),
    source_relevance INTEGER,

    -- Type 4: Conversational refinement
    follow_up_query TEXT,
    refined_trace_id VARCHAR(50),

    -- Type 5: Expert preference (divergent mode)
    preferred_expert VARCHAR(50),

    -- User authority (for weighted feedback)
    user_authority FLOAT,

    -- Timestamp
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT chk_inline_rating CHECK (
        inline_rating IS NULL OR (inline_rating >= 1 AND inline_rating <= 5)
    ),
    CONSTRAINT chk_retrieval_score CHECK (
        retrieval_score IS NULL OR (retrieval_score >= 0 AND retrieval_score <= 1)
    ),
    CONSTRAINT chk_reasoning_score CHECK (
        reasoning_score IS NULL OR (reasoning_score >= 0 AND reasoning_score <= 1)
    ),
    CONSTRAINT chk_synthesis_score CHECK (
        synthesis_score IS NULL OR (synthesis_score >= 0 AND synthesis_score <= 1)
    ),
    CONSTRAINT chk_source_relevance CHECK (
        source_relevance IS NULL OR (source_relevance >= 1 AND source_relevance <= 5)
    )
);

-- Indices for qa_feedback
CREATE INDEX IF NOT EXISTS idx_qa_feedback_trace ON qa_feedback(trace_id);
CREATE INDEX IF NOT EXISTS idx_qa_feedback_user ON qa_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_qa_feedback_type ON qa_feedback(inline_rating, retrieval_score, source_relevance);


-- Comments
COMMENT ON TABLE qa_traces IS 'Pipeline execution traces with consent-aware storage';
COMMENT ON COLUMN qa_traces.consent_level IS 'anonymous: redact query+user_id, basic: redact query, full: no redaction';
COMMENT ON COLUMN qa_traces.query_type IS 'definitional, interpretive, comparative, procedural, etc.';
COMMENT ON COLUMN qa_traces.routing_method IS 'neural, llm_fallback, regex';
COMMENT ON COLUMN qa_traces.is_archived IS 'Archived traces are excluded from default queries';

COMMENT ON TABLE qa_feedback IS 'Multi-level feedback for RLCF training';
COMMENT ON COLUMN qa_feedback.inline_rating IS '1=thumbs down, 5=thumbs up';
COMMENT ON COLUMN qa_feedback.preferred_expert IS 'literal, systemic, principles, precedent';
