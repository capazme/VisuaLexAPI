-- ====================================================
-- Migration 002: Net Score Consensus
-- ====================================================
--
-- Changes consensus calculation from separate approval/rejection thresholds
-- to a single net_score (approval - rejection) that can be positive or negative.
--
-- New logic:
--   net_score = approval_score - rejection_score
--   - If net_score >= +2.0 → approved
--   - If net_score <= -2.0 → rejected (entity discarded)
--   - Otherwise → pending
--
-- This allows the community to effectively "kill" bad proposals
-- with enough rejection votes.
--

-- ====================================================
-- 1. Add net_score column to pending tables
-- ====================================================

-- Add to pending_entities
ALTER TABLE pending_entities
ADD COLUMN IF NOT EXISTS net_score FLOAT DEFAULT 0.0;

-- Add to pending_relations
ALTER TABLE pending_relations
ADD COLUMN IF NOT EXISTS net_score FLOAT DEFAULT 0.0;

-- Add to pending_amendments
ALTER TABLE pending_amendments
ADD COLUMN IF NOT EXISTS net_score FLOAT DEFAULT 0.0;

-- ====================================================
-- 2. Update existing records to calculate net_score
-- ====================================================

UPDATE pending_entities
SET net_score = COALESCE(approval_score, 0) - COALESCE(rejection_score, 0);

UPDATE pending_relations
SET net_score = COALESCE(approval_score, 0) - COALESCE(rejection_score, 0);

UPDATE pending_amendments
SET net_score = COALESCE(approval_score, 0) - COALESCE(rejection_score, 0);

-- ====================================================
-- 3. Replace Entity Consensus Trigger
-- ====================================================

CREATE OR REPLACE FUNCTION update_entity_consensus()
RETURNS TRIGGER AS $$
DECLARE
    total_approval FLOAT;
    total_rejection FLOAT;
    vote_count INT;
    net_score_val FLOAT;
    consensus_threshold FLOAT := 2.0;  -- Applies to both positive and negative
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

    -- Calculate net score
    net_score_val := total_approval - total_rejection;

    -- Update pending_entities with new consensus logic
    UPDATE pending_entities
    SET
        approval_score = total_approval,
        rejection_score = total_rejection,
        net_score = net_score_val,
        votes_count = vote_count,
        -- Consensus reached when net_score crosses either threshold
        consensus_reached = (net_score_val >= consensus_threshold OR net_score_val <= -consensus_threshold),
        consensus_type = CASE
            WHEN net_score_val >= consensus_threshold THEN 'approved'
            WHEN net_score_val <= -consensus_threshold THEN 'rejected'
            ELSE NULL
        END,
        -- Update validation_status when rejected
        validation_status = CASE
            WHEN net_score_val <= -consensus_threshold THEN 'rejected'
            WHEN net_score_val >= consensus_threshold THEN 'approved'
            ELSE validation_status
        END,
        updated_at = NOW()
    WHERE entity_id = NEW.entity_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ====================================================
-- 4. Replace Relation Consensus Trigger
-- ====================================================

CREATE OR REPLACE FUNCTION update_relation_consensus()
RETURNS TRIGGER AS $$
DECLARE
    total_approval FLOAT;
    total_rejection FLOAT;
    vote_count INT;
    net_score_val FLOAT;
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

    net_score_val := total_approval - total_rejection;

    UPDATE pending_relations
    SET
        approval_score = total_approval,
        rejection_score = total_rejection,
        net_score = net_score_val,
        votes_count = vote_count,
        consensus_reached = (net_score_val >= consensus_threshold OR net_score_val <= -consensus_threshold),
        consensus_type = CASE
            WHEN net_score_val >= consensus_threshold THEN 'approved'
            WHEN net_score_val <= -consensus_threshold THEN 'rejected'
            ELSE NULL
        END,
        validation_status = CASE
            WHEN net_score_val <= -consensus_threshold THEN 'rejected'
            WHEN net_score_val >= consensus_threshold THEN 'approved'
            ELSE validation_status
        END,
        updated_at = NOW()
    WHERE relation_id = NEW.relation_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ====================================================
-- 5. Replace Amendment Consensus Trigger
-- ====================================================

CREATE OR REPLACE FUNCTION update_amendment_consensus()
RETURNS TRIGGER AS $$
DECLARE
    total_approval FLOAT;
    total_rejection FLOAT;
    vote_count INT;
    net_score_val FLOAT;
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

    net_score_val := total_approval - total_rejection;

    UPDATE pending_amendments
    SET
        approval_score = total_approval,
        rejection_score = total_rejection,
        net_score = net_score_val,
        votes_count = vote_count,
        consensus_reached = (net_score_val >= consensus_threshold OR net_score_val <= -consensus_threshold),
        consensus_type = CASE
            WHEN net_score_val >= consensus_threshold THEN 'approved'
            WHEN net_score_val <= -consensus_threshold THEN 'rejected'
            ELSE NULL
        END,
        validation_status = CASE
            WHEN net_score_val <= -consensus_threshold THEN 'rejected'
            WHEN net_score_val >= consensus_threshold THEN 'approved'
            ELSE validation_status
        END,
        updated_at = NOW()
    WHERE amendment_id = NEW.amendment_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ====================================================
-- 6. Create index on net_score for efficient queries
-- ====================================================

CREATE INDEX IF NOT EXISTS idx_pending_entities_net_score ON pending_entities(net_score);
CREATE INDEX IF NOT EXISTS idx_pending_relations_net_score ON pending_relations(net_score);
CREATE INDEX IF NOT EXISTS idx_pending_amendments_net_score ON pending_amendments(net_score);

-- ====================================================
-- 7. Add comment for documentation
-- ====================================================

COMMENT ON COLUMN pending_entities.net_score IS
    'Net consensus score (approval_score - rejection_score). >= +2.0 approved, <= -2.0 rejected';
COMMENT ON COLUMN pending_relations.net_score IS
    'Net consensus score (approval_score - rejection_score). >= +2.0 approved, <= -2.0 rejected';
COMMENT ON COLUMN pending_amendments.net_score IS
    'Net consensus score (approval_score - rejection_score). >= +2.0 approved, <= -2.0 rejected';
