"""Dossier models for work folders/projects."""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer, Enum as SQLEnum, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base
import uuid
import enum


class DossierItemType(str, enum.Enum):
    """Types of items in a dossier."""
    NORM = "norm"
    NOTE = "note"
    SECTION = "section"  # For organizing items


class Dossier(Base):
    """Dossier model for organizing research/work projects."""

    __tablename__ = "dossiers"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(7), nullable=True)  # Hex color
    icon = Column(String(50), nullable=True)  # Icon name

    # User ownership
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="dossiers")
    items = relationship("DossierItem", back_populates="dossier", cascade="all, delete-orphan", order_by="DossierItem.position")

    def __repr__(self):
        return f"<Dossier(id={self.id}, name={self.name})>"

    def to_dict(self, include_items=False):
        """Convert dossier to dictionary."""
        data = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "color": self.color,
            "icon": self.icon,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_items and hasattr(self, "items"):
            data["items"] = [item.to_dict() for item in self.items]
        return data


class DossierItem(Base):
    """Individual item within a dossier."""

    __tablename__ = "dossier_items"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    # Dossier relationship
    dossier_id = Column(String, ForeignKey("dossiers.id", ondelete="CASCADE"), nullable=False, index=True)

    # Item type and data
    item_type = Column(SQLEnum(DossierItemType), nullable=False)
    data = Column(JSON, nullable=False)  # Flexible storage for norm data or note content

    # Ordering
    position = Column(Integer, default=0)

    # Optional parent for nested structure (sections containing items)
    parent_id = Column(String, ForeignKey("dossier_items.id", ondelete="CASCADE"), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    dossier = relationship("Dossier", back_populates="items")
    parent = relationship("DossierItem", remote_side=[id], backref="children")

    def __repr__(self):
        return f"<DossierItem(id={self.id}, type={self.item_type}, dossier_id={self.dossier_id})>"

    def to_dict(self, include_children=False):
        """Convert dossier item to dictionary."""
        data = {
            "id": self.id,
            "item_type": self.item_type.value if self.item_type else None,
            "data": self.data,
            "position": self.position,
            "parent_id": self.parent_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_children and hasattr(self, "children"):
            data["children"] = [child.to_dict(include_children=True) for child in self.children]
        return data
