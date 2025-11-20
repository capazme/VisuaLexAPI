"""Highlight model for text highlighting."""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base
import uuid


class Highlight(Base):
    """Highlight model for text selections with color coding."""

    __tablename__ = "highlights"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    # Article identification
    norma_key = Column(String, nullable=False, index=True)

    # Highlighted text
    text = Column(Text, nullable=False)

    # Color (yellow, green, red, blue)
    color = Column(String(20), nullable=False, default="yellow")

    # Position information for reconstruction
    start_offset = Column(Integer, nullable=True)
    end_offset = Column(Integer, nullable=True)
    container_id = Column(String, nullable=True)  # DOM element ID/class

    # Optional note attached to highlight
    note = Column(Text, nullable=True)

    # Optional: Link to bookmark
    bookmark_id = Column(String, ForeignKey("bookmarks.id", ondelete="CASCADE"), nullable=True)

    # User ownership
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="highlights")
    bookmark = relationship("Bookmark", back_populates="highlights")

    def __repr__(self):
        return f"<Highlight(id={self.id}, norma_key={self.norma_key}, color={self.color})>"

    def to_dict(self):
        """Convert highlight to dictionary."""
        return {
            "id": self.id,
            "norma_key": self.norma_key,
            "text": self.text,
            "color": self.color,
            "start_offset": self.start_offset,
            "end_offset": self.end_offset,
            "container_id": self.container_id,
            "note": self.note,
            "bookmark_id": self.bookmark_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
