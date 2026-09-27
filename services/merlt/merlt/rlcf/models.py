import datetime
import enum
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Text,
    DateTime,
    Boolean,
    ForeignKey,
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.sqlite import JSON  # Import for JSON type
from .database import Base


class TaskType(str, enum.Enum):
    """
    Official RLCF Task Types aligned with MERL-T methodology.

    These represent fundamental legal reasoning patterns and RLCF entry points
    in the MERL-T pipeline. Variations should be handled via task_config.yaml
    metadata, not additional enum types.

    Reference: docs/02-methodology/rlcf/technical/database-schema.md
    Reference: docs/02-methodology/legal-reasoning.md (RLCF integration points)

    Task Types organized by MERL-T pipeline stage:

    Tier 1 - Core Pipeline (RLCF Entry Points):
      STATUTORY_RULE_QA: Statutory interpretation (Literal Interpreter output)
      QA: General legal Q&A (Synthesis output, Systemic/Precedent expert outputs)
      RETRIEVAL_VALIDATION: Validates retrieval quality (NEW - covers KG/API/Vector agents)

    Tier 2 - Reasoning Layer:
      PREDICTION: Legal outcome prediction
      NLI: Natural language inference
      RISK_SPOTTING: Compliance risk identification
      DOCTRINE_APPLICATION: Legal principle application (Principles Balancer output)

    Tier 3 - Preprocessing & Specialized:
      CLASSIFICATION: Document categorization
      SUMMARIZATION: Document summarization
      NER: Named entity recognition (Query Understanding validation)
      DRAFTING: Legal document drafting
    """

    # Tier 1: Core Pipeline & RLCF Entry Points
    STATUTORY_RULE_QA = "STATUTORY_RULE_QA"  # Literal Interpreter outputs
    QA = "QA"  # Synthesis, general expert outputs
    RETRIEVAL_VALIDATION = "RETRIEVAL_VALIDATION"  # NEW: Validates KG/API/Vector retrieval

    # Tier 2: Reasoning Layer
    PREDICTION = "PREDICTION"  # Legal outcome prediction
    NLI = "NLI"  # Natural language inference
    RISK_SPOTTING = "RISK_SPOTTING"  # Compliance risk identification
    DOCTRINE_APPLICATION = "DOCTRINE_APPLICATION"  # Principles Balancer outputs

    # Tier 3: Preprocessing & Specialized
    CLASSIFICATION = "CLASSIFICATION"  # Document categorization
    SUMMARIZATION = "SUMMARIZATION"  # Document summarization
    NER = "NER"  # Named entity recognition
    DRAFTING = "DRAFTING"  # Legal document drafting


class TaskStatus(str, enum.Enum):
    OPEN = "OPEN"
    BLIND_EVALUATION = "BLIND_EVALUATION"
    AGGREGATED = "AGGREGATED"
    CLOSED = "CLOSED"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    authority_score = Column(Float, default=0.0)
    track_record_score = Column(Float, default=0.0)
    baseline_credential_score = Column(Float, default=0.0)

    # MULTILIVELLO v2: Authority per dominio e livello pipeline
    # Formato: {"civile": {"baseline": 0.5, "track_record": 0.5, "current": 0.5}, ...}
    domain_authority_data = Column(JSON, nullable=True, default=dict)
    # Formato: {"retrieval": {"baseline": 0.5, ...}, "reasoning": {...}, "synthesis": {...}}
    level_authority_data = Column(JSON, nullable=True, default=dict)

    credentials = relationship("Credential", back_populates="owner")
    feedback = relationship("Feedback", back_populates="author")


class Credential(Base):
    __tablename__ = "credentials"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    type = Column(String)
    value = Column(String)
    weight = Column(Float)

    owner = relationship("User", back_populates="credentials")


class LegalTask(Base):
    __tablename__ = "legal_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_type = Column(String, nullable=False, index=True)  # Indexed for filtering
    input_data = Column(JSON, nullable=False)  # New: Flexible input data
    ground_truth_data = Column(JSON, nullable=True)  # Nuovo campo!
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)  # Indexed for sorting
    status = Column(String, default=TaskStatus.OPEN, index=True)  # Indexed for filtering

    responses = relationship("Response", back_populates="task")
    bias_reports = relationship("BiasReport")


class Response(Base):
    __tablename__ = "responses"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("legal_tasks.id"))
    output_data = Column(JSON, nullable=False)  # New: Flexible output data
    model_version = Column(String)
    generated_at = Column(DateTime, default=datetime.datetime.utcnow)

    task = relationship("LegalTask", back_populates="responses")
    feedback = relationship("Feedback", back_populates="response")


class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)  # Indexed for user queries
    response_id = Column(Integer, ForeignKey("responses.id"), index=True)  # Indexed for joins
    is_blind_phase = Column(Boolean, default=True)
    accuracy_score = Column(Float)
    utility_score = Column(Float)
    transparency_score = Column(Float)
    feedback_data = Column(JSON, nullable=False)  # New: Flexible feedback data
    community_helpfulness_rating = Column(Integer, default=0)
    consistency_score = Column(Float, nullable=True)
    correctness_score = Column(Float, nullable=True)  # Nuovo campo per il ground truth
    submitted_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)  # Indexed for sorting

    # MULTILIVELLO v2: Dominio giuridico e livello pipeline
    legal_domain = Column(String, nullable=True, index=True)  # civile, penale, etc.
    pipeline_level = Column(String, nullable=True, index=True)  # retrieval, reasoning, synthesis

    author = relationship("User", back_populates="feedback")
    response = relationship("Response", back_populates="feedback")
    ratings = relationship("FeedbackRating", back_populates="rated_feedback")


class FeedbackRating(Base):
    __tablename__ = "feedback_ratings"

    id = Column(Integer, primary_key=True, index=True)
    feedback_id = Column(Integer, ForeignKey("feedback.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    helpfulness_score = Column(Integer)  # e.g., from 1 to 5

    rated_feedback = relationship("Feedback", back_populates="ratings")
    rater = relationship("User")


class BiasReport(Base):
    __tablename__ = "bias_reports"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("legal_tasks.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    bias_type = Column(String)  # es. "PROFESSIONAL_CLUSTERING"
    bias_score = Column(Float)
    analysis_details = Column(JSON, nullable=True)  # Detailed bias analysis metadata
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class DevilsAdvocateAssignment(Base):
    __tablename__ = "devils_advocate_assignments"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("legal_tasks.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    instructions = Column(Text)
    assigned_at = Column(DateTime, default=datetime.datetime.utcnow)

    task = relationship("LegalTask")
    user = relationship("User")


class TaskAssignment(Base):
    __tablename__ = "task_assignments"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("legal_tasks.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    role = Column(String, default="evaluator")
    assigned_at = Column(DateTime, default=datetime.datetime.utcnow)

    task = relationship("LegalTask")
    user = relationship("User")


class AccountabilityReport(Base):
    __tablename__ = "accountability_reports"

    id = Column(Integer, primary_key=True, index=True)
    cycle_start = Column(DateTime, nullable=False)
    cycle_end = Column(DateTime, nullable=False)
    report_data = Column(JSON, nullable=False)
    published_at = Column(DateTime, default=datetime.datetime.utcnow)
