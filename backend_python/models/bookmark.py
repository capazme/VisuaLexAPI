"""Bookmark model for saved legal articles."""
from sqlalchemy import Column, String, DateTime, ForeignKey, JSON, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import ARRAY
from database import Base
import uuid


class Bookmark(Base):
    """Bookmark model for saving legal article references."""

    __tablename__ = "bookmarks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    # Norma identification (from frontend normaKey)
    norma_key = Column(String, nullable=False, index=True)

    # Norma data (stored as JSON for flexibility)
    norma_data = Column(JSON, nullable=False)

    # Organization
    folder_id = Column(String, ForeignKey("folders.id", ondelete="SET NULL"), nullable=True, index=True)
    tags = Column(ARRAY(String), default=list)

    # User notes
    notes = Column(Text, nullable=True)

    # User ownership
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="bookmarks")
    folder = relationship("Folder", back_populates="bookmarks")
    annotations = relationship("Annotation", back_populates="bookmark", cascade="all, delete-orphan")
    highlights = relationship("Highlight", back_populates="bookmark", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Bookmark(id={self.id}, norma_key={self.norma_key})>"

    def to_dict(self):
        """Convert bookmark to dictionary."""
        return {
            "id": self.id,
            "norma_key": self.norma_key,
            "norma_data": self.norma_data,
            "folder_id": self.folder_id,
            "tags": self.tags or [],
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
