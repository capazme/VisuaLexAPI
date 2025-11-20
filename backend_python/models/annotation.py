"""Annotation model for user notes on articles."""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Enum as SQLEnum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base
import uuid
import enum


class AnnotationType(str, enum.Enum):
    """Types of annotations."""
    NOTE = "note"
    QUESTION = "question"
    IMPORTANT = "important"
    FOLLOW_UP = "follow_up"
    SUMMARY = "summary"


class Annotation(Base):
    """Annotation model for user notes on specific articles."""

    __tablename__ = "annotations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    # Article identification
    norma_key = Column(String, nullable=False, index=True)

    # Annotation content
    content = Column(Text, nullable=False)
    annotation_type = Column(SQLEnum(AnnotationType), default=AnnotationType.NOTE)

    # Optional: Link to bookmark
    bookmark_id = Column(String, ForeignKey("bookmarks.id", ondelete="CASCADE"), nullable=True)

    # Text context (optional snapshot of the text being annotated)
    text_context = Column(Text, nullable=True)

    # Position in document (for ordering)
    position = Column(String, nullable=True)  # e.g., "paragraph-3-line-5"

    # User ownership
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="annotations")
    bookmark = relationship("Bookmark", back_populates="annotations")

    def __repr__(self):
        return f"<Annotation(id={self.id}, norma_key={self.norma_key}, type={self.annotation_type})>"

    def to_dict(self):
        """Convert annotation to dictionary."""
        return {
            "id": self.id,
            "norma_key": self.norma_key,
            "content": self.content,
            "annotation_type": self.annotation_type.value if self.annotation_type else None,
            "bookmark_id": self.bookmark_id,
            "text_context": self.text_context,
            "position": self.position,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
