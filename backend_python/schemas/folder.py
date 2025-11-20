"""Pydantic schemas for folder operations."""
from pydantic import BaseModel, Field, validator
from typing import Optional, List
from datetime import datetime


class FolderCreate(BaseModel):
    """Schema for creating a new folder."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    color: Optional[str] = Field(None, regex=r"^#[0-9A-Fa-f]{6}$")
    icon: Optional[str] = Field(None, max_length=50)
    parent_id: Optional[str] = None
    position: Optional[int] = 0


class FolderUpdate(BaseModel):
    """Schema for updating a folder."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    color: Optional[str] = Field(None, regex=r"^#[0-9A-Fa-f]{6}$")
    icon: Optional[str] = Field(None, max_length=50)
    parent_id: Optional[str] = None
    position: Optional[int] = None


class FolderMove(BaseModel):
    """Schema for moving a folder to a new parent."""
    parent_id: Optional[str] = None
    position: Optional[int] = 0


class FolderResponse(BaseModel):
    """Schema for folder response."""
    id: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    parent_id: Optional[str] = None
    position: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    children: Optional[List["FolderResponse"]] = None

    class Config:
        from_attributes = True


# Update forward reference
FolderResponse.model_rebuild()


class FolderTree(BaseModel):
    """Schema for folder tree with nested children."""
    id: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    parent_id: Optional[str] = None
    position: int
    children: List["FolderTree"] = []
    bookmark_count: Optional[int] = 0

    class Config:
        from_attributes = True


# Update forward reference
FolderTree.model_rebuild()


class FolderBulkDelete(BaseModel):
    """Schema for bulk deleting folders."""
    folder_ids: List[str] = Field(..., min_items=1)


class FolderBulkMove(BaseModel):
    """Schema for bulk moving folders."""
    folder_ids: List[str] = Field(..., min_items=1)
    target_parent_id: Optional[str] = None
