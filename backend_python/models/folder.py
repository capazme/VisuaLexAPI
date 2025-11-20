"""Folder model for hierarchical organization."""
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base
import uuid


class Folder(Base):
    """Folder model with hierarchical support (adjacency list pattern)."""

    __tablename__ = "folders"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(7), nullable=True)  # Hex color like #FF5733
    icon = Column(String(50), nullable=True)  # Icon name from lucide-react

    # Hierarchy
    parent_id = Column(String, ForeignKey("folders.id", ondelete="CASCADE"), nullable=True, index=True)
    position = Column(Integer, default=0)  # For ordering within same parent

    # User ownership
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="folders")
    parent = relationship("Folder", remote_side=[id], backref="children")
    bookmarks = relationship("Bookmark", back_populates="folder", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Folder(id={self.id}, name={self.name}, parent_id={self.parent_id})>"

    @property
    def path(self):
        """Get full path of folder (e.g., 'Parent/Child/Grandchild')."""
        if self.parent:
            return f"{self.parent.path}/{self.name}"
        return self.name

    def to_dict(self, include_children=False):
        """Convert folder to dictionary."""
        data = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "color": self.color,
            "icon": self.icon,
            "parent_id": self.parent_id,
            "position": self.position,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_children and hasattr(self, "children"):
            data["children"] = [child.to_dict(include_children=True) for child in self.children]
        return data
