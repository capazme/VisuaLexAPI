-- ====================================================
-- LIVE ENRICHMENT + USER DOCUMENTS + MULTIVIGENZA SCHEMA
-- ====================================================
--
-- Phase 1: Core Fixes - PostgreSQL DB Persistence
-- Sostituisce in-memory storage con persistent validation
--
-- Features:
-- 1. Live entity extraction from articles
-- 2. User-uploaded documents (PDF, TXT, manuale Torrente)
-- 3. Amendment extraction & validation (multivigenza)
-- 4. Community voting & consensus tracking
-- 5. Domain authority calculation
--
-- Migration Strategy: Hard Cutover
-- - Deploy new schema
-- - Update enrichment_router.py to use DB
-- - No data migration needed (fresh start)
--
-- Created: 2026-01-04
-- ====================================================

-- ====================================================
-- 1. USER DOCUMENTS (Must be created first - referenced by FKs)
-- ====================================================
-- Store user-uploaded documents (PDF, TXT, manuale Torrente)
-- Use case: Upload "Manuale Torrente" to extract doctrine
CREATE TABLE IF NOT EXISTS user_documents (
    id SERIAL PRIMARY KEY,

    -- Document metadata
    filename VARCHAR(500) NOT NULL,
    original_filename VARCHAR(500) NOT NULL,
    file_type VARCHAR(50) NOT NULL,  -- 'pdf', 'txt', 'docx'
    file_size_bytes BIGINT,
    file_hash VARCHAR(64) UNIQUE,  -- SHA-256 for deduplication

    -- Storage
    storage_path TEXT NOT NULL,  -- Local path or S3 URL

    -- Document classification
    document_type VARCHAR(100),  -- 'dottrina', 'manuale', 'sentenza', 'altro'
    legal_domain VARCHAR(50),  -- 'civile', 'penale', etc.
    title TEXT,
    author TEXT,
    publication_year INT,

    -- Processing status
    processing_status VARCHAR(50) DEFAULT 'uploaded',
    -- 'uploaded' | 'parsing' | 'extracting' | 'completed' | 'failed'

    processing_error TEXT,

    -- Extraction results (cached counts)
    entities_extracted INT DEFAULT 0,
    relations_extracted INT DEFAULT 0,
    amendments_extracted INT DEFAULT 0,

    -- Contributor
    uploaded_by VARCHAR(100) NOT NULL,  -- User ID

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    processing_started_at TIMESTAMP,
    processing_completed_at TIMESTAMP
);

CREATE INDEX idx_user_documents_uploader ON user_documents(uploaded_by);
CREATE INDEX idx_user_documents_status ON user_documents(processing_status);
CREATE INDEX idx_user_documents_type ON user_documents(document_type);
CREATE INDEX idx_user_documents_hash ON user_documents(file_hash);


-- ====================================================
-- 2. PENDING ENTITIES (Live Enrichment)
-- ====================================================
CREATE TABLE IF NOT EXISTS pending_entities (
    -- Identity
    id SERIAL PRIMARY KEY,
    entity_id VARCHAR(100) UNIQUE NOT NULL,  -- "concetto:legittima_difesa"

    -- Source
    article_urn VARCHAR(300) NOT NULL,  -- URN articolo da cui estratto
    source_type VARCHAR(50) DEFAULT 'article',  -- 'article' | 'user_document' | 'manual_entry'
    source_document_id INTEGER,  -- FK to user_documents (if source_type = 'user_document')

    -- Entity data (from LLM extraction)
    entity_type VARCHAR(50) NOT NULL,  -- EntityType enum value
    entity_text TEXT NOT NULL,  -- Nome entità estratto
    descrizione TEXT,  -- Descrizione LLM
    ambito VARCHAR(50),  -- 'civile', 'penale', 'amministrativo', etc.
    fonte VARCHAR(50) DEFAULT 'llm_extraction',  -- 'llm_extraction' | 'community' | 'manual'

    -- LLM metadata
    llm_confidence FLOAT CHECK (llm_confidence >= 0 AND llm_confidence <= 1),
    llm_model VARCHAR(100),  -- "gpt-4", "claude-sonnet-4", etc.
    llm_reasoning TEXT,  -- Chain-of-thought reasoning

    -- Validation status
    validation_status VARCHAR(20) DEFAULT 'pending',
    -- 'pending' | 'approved' | 'rejected' | 'needs_revision'

    -- Community consensus (calculated from entity_votes)
    approval_score FLOAT DEFAULT 0,  -- Sum of (vote_value * voter_authority)
    rejection_score FLOAT DEFAULT 0,
    votes_count INT DEFAULT 0,
    consensus_reached BOOLEAN DEFAULT FALSE,
    consensus_type VARCHAR(20),  -- 'approved' | 'rejected' | NULL

    -- Contributor tracking
    contributed_by VARCHAR(100),  -- User ID
    contributor_authority FLOAT,  -- Authority at submission time

    -- Deduplication tracking
    duplicate_check_mechanical BOOLEAN DEFAULT FALSE,  -- Layer 1: exact match done
    duplicate_check_llm BOOLEAN DEFAULT FALSE,  -- Layer 2: semantic check done
    potential_duplicate_of VARCHAR(100),  -- Reference to existing node_id

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    approved_at TIMESTAMP,
    written_to_graph_at TIMESTAMP,  -- When written to FalkorDB

    -- Indexes
    CONSTRAINT fk_source_document
        FOREIGN KEY (source_document_id)
        REFERENCES user_documents(id)
        ON DELETE SET NULL
);

CREATE INDEX idx_pending_entities_status ON pending_entities(validation_status);
CREATE INDEX idx_pending_entities_type ON pending_entities(entity_type);
CREATE INDEX idx_pending_entities_article ON pending_entities(article_urn);
CREATE INDEX idx_pending_entities_contributor ON pending_entities(contributed_by);
CREATE INDEX idx_pending_entities_consensus ON pending_entities(consensus_reached, validation_status);


-- ====================================================
-- 2. ENTITY VOTES (Community Validation)
-- ====================================================
CREATE TABLE IF NOT EXISTS entity_votes (
    id SERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL,  -- FK to pending_entities.entity_id
    user_id VARCHAR(100) NOT NULL,  -- Voter ID

    -- Vote data
    vote_value INT NOT NULL CHECK (vote_value IN (-1, 1)),  -- -1 reject, +1 approve
    vote_type VARCHAR(20) NOT NULL,  -- 'accuracy' | 'utility' | 'duplicate'

    -- Voter context
    voter_authority FLOAT,  -- Authority at vote time (cached)
    voter_domain_authority FLOAT,  -- Domain-specific authority
    legal_domain VARCHAR(50),  -- Domain this vote applies to

    -- Vote reasoning (optional)
    comment TEXT,
    suggested_revision TEXT,  -- If rejecting, suggest improvement

    -- Duplicate handling
    duplicate_of_node_id VARCHAR(100),  -- If vote_type='duplicate', point to existing node

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),

    -- Constraints
    UNIQUE(entity_id, user_id, vote_type),  -- One vote per user per type
    CONSTRAINT fk_entity
        FOREIGN KEY (entity_id)
        REFERENCES pending_entities(entity_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_entity_votes_entity ON entity_votes(entity_id);
CREATE INDEX idx_entity_votes_user ON entity_votes(user_id);
CREATE INDEX idx_entity_votes_domain ON entity_votes(legal_domain);


-- ====================================================
-- 3. PENDING RELATIONS (Live Enrichment)
-- ====================================================
CREATE TABLE IF NOT EXISTS pending_relations (
    -- Identity
    id SERIAL PRIMARY KEY,
    relation_id VARCHAR(150) UNIQUE NOT NULL,  -- "ESPRIME_PRINCIPIO:art1453:principio_inadempimento"

    -- Source
    article_urn VARCHAR(300) NOT NULL,
    source_type VARCHAR(50) DEFAULT 'article',  -- 'article' | 'user_document' | 'amendment'
    source_document_id INTEGER,  -- FK to user_documents

    -- Relation data
    relation_type VARCHAR(100) NOT NULL,  -- RelationType enum value
    source_node_urn VARCHAR(300) NOT NULL,  -- URN nodo sorgente (articolo)
    target_entity_id VARCHAR(100) NOT NULL,  -- ID entità target (pending or approved)

    -- Relation metadata
    relation_description TEXT,  -- LLM explanation
    certezza FLOAT CHECK (certezza >= 0 AND certezza <= 1),  -- Confidence
    llm_confidence FLOAT,
    llm_model VARCHAR(100),
    llm_reasoning TEXT,

    -- Validation status
    validation_status VARCHAR(20) DEFAULT 'pending',
    approval_score FLOAT DEFAULT 0,
    rejection_score FLOAT DEFAULT 0,
    votes_count INT DEFAULT 0,
    consensus_reached BOOLEAN DEFAULT FALSE,
    consensus_type VARCHAR(20),

    -- Contributor
    contributed_by VARCHAR(100),
    contributor_authority FLOAT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    approved_at TIMESTAMP,
    written_to_graph_at TIMESTAMP,

    CONSTRAINT fk_source_doc_rel
        FOREIGN KEY (source_document_id)
        REFERENCES user_documents(id)
        ON DELETE SET NULL
);

CREATE INDEX idx_pending_relations_status ON pending_relations(validation_status);
CREATE INDEX idx_pending_relations_type ON pending_relations(relation_type);
CREATE INDEX idx_pending_relations_source ON pending_relations(source_node_urn);
CREATE INDEX idx_pending_relations_target ON pending_relations(target_entity_id);


-- ====================================================
-- 4. RELATION VOTES
-- ====================================================
CREATE TABLE IF NOT EXISTS relation_votes (
    id SERIAL PRIMARY KEY,
    relation_id VARCHAR(150) NOT NULL,
    user_id VARCHAR(100) NOT NULL,

    vote_value INT NOT NULL CHECK (vote_value IN (-1, 1)),
    vote_type VARCHAR(20) NOT NULL,  -- 'accuracy' | 'utility'

    voter_authority FLOAT,
    voter_domain_authority FLOAT,
    legal_domain VARCHAR(50),

    comment TEXT,
    suggested_revision TEXT,

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(relation_id, user_id, vote_type),
    CONSTRAINT fk_relation
        FOREIGN KEY (relation_id)
        REFERENCES pending_relations(relation_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_relation_votes_relation ON relation_votes(relation_id);
CREATE INDEX idx_relation_votes_user ON relation_votes(user_id);


-- ====================================================
-- 6. PENDING AMENDMENTS (Multivigenza Integration)
-- ====================================================
-- Stores proposed amendments (multivigenza) for validation
-- Can be extracted from user documents or manually entered
CREATE TABLE IF NOT EXISTS pending_amendments (
    id SERIAL PRIMARY KEY,
    amendment_id VARCHAR(150) UNIQUE NOT NULL,  -- "amend:art1453:legge_241_1990"

    -- Target article
    target_article_urn VARCHAR(300) NOT NULL,  -- Article being modified

    -- Modifying act (atto modificante)
    atto_modificante_urn VARCHAR(300),  -- URN of modifying act
    atto_modificante_estremi TEXT NOT NULL,  -- "LEGGE 7 agosto 1990, n. 241"

    -- Parsed atto components (from parse_estremi)
    tipo_atto VARCHAR(100),  -- 'legge', 'decreto-legge', etc.
    tipo_documento VARCHAR(100),  -- Normalized type
    data_atto DATE,
    numero_atto VARCHAR(50),

    -- Disposizione (which part of modifying act)
    disposizione TEXT NOT NULL,  -- "art. 12, comma 1, lettera b"

    -- Parsed disposizione components (from parse_disposizione)
    numero_articolo_disposizione VARCHAR(50),
    commi_disposizione TEXT[],  -- Array of comma numbers
    lettere_disposizione TEXT[],  -- Array of letters
    numeri_disposizione TEXT[],  -- Array of numbers

    -- Amendment type
    tipo_modifica VARCHAR(50) NOT NULL,  -- 'ABROGA' | 'SOSTITUISCE' | 'MODIFICA' | 'INSERISCE'

    -- Dates
    data_pubblicazione_gu DATE,  -- Gazzetta Ufficiale publication
    data_efficacia DATE,  -- When amendment takes effect

    -- Source
    source_type VARCHAR(50) DEFAULT 'manual',  -- 'manual' | 'user_document' | 'normattiva_scraper'
    source_document_id INTEGER,  -- FK to user_documents (if extracted from doc)

    -- LLM extraction (if applicable)
    llm_confidence FLOAT,
    llm_model VARCHAR(100),
    llm_reasoning TEXT,

    -- Validation status
    validation_status VARCHAR(20) DEFAULT 'pending',
    approval_score FLOAT DEFAULT 0,
    rejection_score FLOAT DEFAULT 0,
    votes_count INT DEFAULT 0,
    consensus_reached BOOLEAN DEFAULT FALSE,
    consensus_type VARCHAR(20),

    -- Contributor
    contributed_by VARCHAR(100) NOT NULL,
    contributor_authority FLOAT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    approved_at TIMESTAMP,
    written_to_graph_at TIMESTAMP,  -- When hierarchical structure created in FalkorDB

    CONSTRAINT fk_source_doc_amend
        FOREIGN KEY (source_document_id)
        REFERENCES user_documents(id)
        ON DELETE SET NULL
);

CREATE INDEX idx_pending_amendments_target ON pending_amendments(target_article_urn);
CREATE INDEX idx_pending_amendments_status ON pending_amendments(validation_status);
CREATE INDEX idx_pending_amendments_tipo ON pending_amendments(tipo_modifica);
CREATE INDEX idx_pending_amendments_atto ON pending_amendments(atto_modificante_urn);


-- ====================================================
-- 7. AMENDMENT VOTES
-- ====================================================
CREATE TABLE IF NOT EXISTS amendment_votes (
    id SERIAL PRIMARY KEY,
    amendment_id VARCHAR(150) NOT NULL,
    user_id VARCHAR(100) NOT NULL,

    vote_value INT NOT NULL CHECK (vote_value IN (-1, 1)),
    vote_type VARCHAR(20) NOT NULL,  -- 'accuracy' | 'utility'

    voter_authority FLOAT,
    voter_domain_authority FLOAT,
    legal_domain VARCHAR(50),

    comment TEXT,
    suggested_revision TEXT,

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(amendment_id, user_id, vote_type),
    CONSTRAINT fk_amendment
        FOREIGN KEY (amendment_id)
        REFERENCES pending_amendments(amendment_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_amendment_votes_amendment ON amendment_votes(amendment_id);
CREATE INDEX idx_amendment_votes_user ON amendment_votes(user_id);


-- ====================================================
-- 8. CONSENSUS CALCULATION TRIGGERS
-- ====================================================
-- Auto-update consensus when votes are added/updated

-- Function: Calculate consensus for entities
CREATE OR REPLACE FUNCTION update_entity_consensus()
RETURNS TRIGGER AS $$
DECLARE
    total_approval FLOAT;
    total_rejection FLOAT;
    vote_count INT;
    consensus_threshold FLOAT := 2.0;  -- Weighted threshold
BEGIN
    -- Sum weighted votes (vote_value * voter_authority)
    SELECT
        COALESCE(SUM(CASE WHEN vote_value = 1 THEN voter_authority ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN vote_value = -1 THEN voter_authority ELSE 0 END), 0),
        COUNT(*)
    INTO total_approval, total_rejection, vote_count
    FROM entity_votes
    WHERE entity_id = NEW.entity_id
      AND vote_type = 'accuracy';

    -- Update pending_entities
    UPDATE pending_entities
    SET
        approval_score = total_approval,
        rejection_score = total_rejection,
        votes_count = vote_count,
        consensus_reached = (total_approval >= consensus_threshold OR total_rejection >= consensus_threshold),
        consensus_type = CASE
            WHEN total_approval >= consensus_threshold THEN 'approved'
            WHEN total_rejection >= consensus_threshold THEN 'rejected'
            ELSE NULL
        END,
        updated_at = NOW()
    WHERE entity_id = NEW.entity_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_entity_vote_consensus
AFTER INSERT OR UPDATE ON entity_votes
FOR EACH ROW
EXECUTE FUNCTION update_entity_consensus();


-- Function: Calculate consensus for relations
CREATE OR REPLACE FUNCTION update_relation_consensus()
RETURNS TRIGGER AS $$
DECLARE
    total_approval FLOAT;
    total_rejection FLOAT;
    vote_count INT;
    consensus_threshold FLOAT := 2.0;
BEGIN
    SELECT
        COALESCE(SUM(CASE WHEN vote_value = 1 THEN voter_authority ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN vote_value = -1 THEN voter_authority ELSE 0 END), 0),
        COUNT(*)
    INTO total_approval, total_rejection, vote_count
    FROM relation_votes
    WHERE relation_id = NEW.relation_id
      AND vote_type = 'accuracy';

    UPDATE pending_relations
    SET
        approval_score = total_approval,
        rejection_score = total_rejection,
        votes_count = vote_count,
        consensus_reached = (total_approval >= consensus_threshold OR total_rejection >= consensus_threshold),
        consensus_type = CASE
            WHEN total_approval >= consensus_threshold THEN 'approved'
            WHEN total_rejection >= consensus_threshold THEN 'rejected'
            ELSE NULL
        END,
        updated_at = NOW()
    WHERE relation_id = NEW.relation_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_relation_vote_consensus
AFTER INSERT OR UPDATE ON relation_votes
FOR EACH ROW
EXECUTE FUNCTION update_relation_consensus();


-- Function: Calculate consensus for amendments
CREATE OR REPLACE FUNCTION update_amendment_consensus()
RETURNS TRIGGER AS $$
DECLARE
    total_approval FLOAT;
    total_rejection FLOAT;
    vote_count INT;
    consensus_threshold FLOAT := 2.0;
BEGIN
    SELECT
        COALESCE(SUM(CASE WHEN vote_value = 1 THEN voter_authority ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN vote_value = -1 THEN voter_authority ELSE 0 END), 0),
        COUNT(*)
    INTO total_approval, total_rejection, vote_count
    FROM amendment_votes
    WHERE amendment_id = NEW.amendment_id
      AND vote_type = 'accuracy';

    UPDATE pending_amendments
    SET
        approval_score = total_approval,
        rejection_score = total_rejection,
        votes_count = vote_count,
        consensus_reached = (total_approval >= consensus_threshold OR total_rejection >= consensus_threshold),
        consensus_type = CASE
            WHEN total_approval >= consensus_threshold THEN 'approved'
            WHEN total_rejection >= consensus_threshold THEN 'rejected'
            ELSE NULL
        END,
        updated_at = NOW()
    WHERE amendment_id = NEW.amendment_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_amendment_vote_consensus
AFTER INSERT OR UPDATE ON amendment_votes
FOR EACH ROW
EXECUTE FUNCTION update_amendment_consensus();


-- ====================================================
-- 9. DOMAIN AUTHORITY TRACKING (New Table)
-- ====================================================
-- Track user's domain-specific authority (accuracy-based)
CREATE TABLE IF NOT EXISTS user_domain_authority (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    legal_domain VARCHAR(50) NOT NULL,  -- 'civile', 'penale', etc.

    -- Accuracy metrics
    total_feedbacks INT DEFAULT 0,
    correct_feedbacks INT DEFAULT 0,  -- Feedbacks where user matched consensus
    accuracy_score FLOAT DEFAULT 0.0,  -- correct / total

    -- Authority score (derived from accuracy + peer validation)
    domain_authority FLOAT DEFAULT 0.5,  -- Starts at 0.5, grows with accuracy

    -- Timestamps
    last_calculated_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, legal_domain)
);

CREATE INDEX idx_domain_authority_user ON user_domain_authority(user_id);
CREATE INDEX idx_domain_authority_domain ON user_domain_authority(legal_domain);


-- ====================================================
-- 10. INITIAL DATA
-- ====================================================
-- No initial data needed for hard cutover
-- Tables start empty and will be populated by live enrichment


-- ====================================================
-- MIGRATION VERIFICATION QUERIES
-- ====================================================
-- Run these after migration to verify schema:

-- Check all tables exist
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;

-- Check indexes
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY tablename, indexname;

-- Check foreign keys
-- SELECT conname, conrelid::regclass AS table_name,
--        confrelid::regclass AS referenced_table
-- FROM pg_constraint
-- WHERE contype = 'f';
