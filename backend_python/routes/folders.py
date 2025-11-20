"""Folder hierarchy routes with CRUD operations."""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, func
from sqlalchemy.orm import selectinload
from typing import List, Optional

from database import get_db
from models.user import User
from models.folder import Folder
from models.bookmark import Bookmark
from schemas.folder import (
    FolderCreate,
    FolderUpdate,
    FolderMove,
    FolderResponse,
    FolderTree,
    FolderBulkDelete,
    FolderBulkMove
)
from auth.dependencies import get_current_user

router = APIRouter(prefix="/folders", tags=["folders"])


async def check_circular_reference(
    db: AsyncSession,
    folder_id: str,
    new_parent_id: Optional[str]
) -> bool:
    """
    Check if moving a folder would create a circular reference.

    Args:
        db: Database session
        folder_id: Folder being moved
        new_parent_id: New parent folder ID

    Returns:
        bool: True if circular reference would be created
    """
    if new_parent_id is None:
        return False

    if folder_id == new_parent_id:
        return True

    # Traverse up the tree from new_parent_id to check if we reach folder_id
    current_id = new_parent_id
    visited = set()

    while current_id is not None:
        if current_id in visited or current_id == folder_id:
            return True

        visited.add(current_id)

        result = await db.execute(
            select(Folder.parent_id).where(Folder.id == current_id)
        )
        parent = result.scalar_one_or_none()
        current_id = parent

    return False


async def build_folder_tree(
    folders: List[Folder],
    parent_id: Optional[str] = None
) -> List[FolderTree]:
    """
    Recursively build folder tree structure.

    Args:
        folders: List of all folders
        parent_id: Parent folder ID to start from

    Returns:
        List[FolderTree]: Tree structure
    """
    tree = []
    for folder in folders:
        if folder.parent_id == parent_id:
            children = await build_folder_tree(folders, folder.id)
            folder_tree = FolderTree(
                id=folder.id,
                name=folder.name,
                description=folder.description,
                color=folder.color,
                icon=folder.icon,
                parent_id=folder.parent_id,
                position=folder.position,
                children=children,
                bookmark_count=len(folder.bookmarks) if hasattr(folder, 'bookmarks') else 0
            )
            tree.append(folder_tree)

    return sorted(tree, key=lambda x: x.position)


@router.post("/", response_model=FolderResponse, status_code=status.HTTP_201_CREATED)
async def create_folder(
    folder_data: FolderCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new folder.

    Args:
        folder_data: Folder creation data
        current_user: Current authenticated user
        db: Database session

    Returns:
        FolderResponse: Created folder

    Raises:
        HTTPException: If parent folder doesn't exist or doesn't belong to user
    """
    # Validate parent folder if specified
    if folder_data.parent_id:
        result = await db.execute(
            select(Folder).where(
                Folder.id == folder_data.parent_id,
                Folder.user_id == current_user.id
            )
        )
        parent = result.scalar_one_or_none()
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent folder not found"
            )

    # Create folder
    new_folder = Folder(
        name=folder_data.name,
        description=folder_data.description,
        color=folder_data.color,
        icon=folder_data.icon,
        parent_id=folder_data.parent_id,
        position=folder_data.position or 0,
        user_id=current_user.id
    )

    db.add(new_folder)
    await db.commit()
    await db.refresh(new_folder)

    return new_folder


@router.get("/", response_model=List[FolderResponse])
async def get_folders(
    include_children: bool = Query(False, description="Include nested children in response"),
    parent_id: Optional[str] = Query(None, description="Filter by parent folder"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all folders for current user.

    Args:
        include_children: Include nested children in response
        parent_id: Filter by parent folder (None for root folders)
        current_user: Current authenticated user
        db: Database session

    Returns:
        List[FolderResponse]: List of folders
    """
    query = select(Folder).where(Folder.user_id == current_user.id)

    if parent_id is not None:
        query = query.where(Folder.parent_id == parent_id)

    if include_children:
        query = query.options(selectinload(Folder.children))

    query = query.order_by(Folder.position, Folder.name)

    result = await db.execute(query)
    folders = result.scalars().all()

    if include_children:
        return [
            FolderResponse(
                **folder.to_dict(include_children=True)
            )
            for folder in folders
        ]

    return folders


@router.get("/tree", response_model=List[FolderTree])
async def get_folder_tree(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get complete folder tree with nested structure.

    Args:
        current_user: Current authenticated user
        db: Database session

    Returns:
        List[FolderTree]: Folder tree structure
    """
    # Get all folders with bookmarks count
    query = select(Folder).where(
        Folder.user_id == current_user.id
    ).options(selectinload(Folder.bookmarks))

    result = await db.execute(query)
    folders = result.scalars().all()

    # Build tree structure
    tree = await build_folder_tree(folders, parent_id=None)

    return tree


@router.get("/{folder_id}", response_model=FolderResponse)
async def get_folder(
    folder_id: str,
    include_children: bool = Query(False, description="Include nested children"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a specific folder by ID.

    Args:
        folder_id: Folder ID
        include_children: Include nested children
        current_user: Current authenticated user
        db: Database session

    Returns:
        FolderResponse: Folder data

    Raises:
        HTTPException: If folder not found or doesn't belong to user
    """
    query = select(Folder).where(
        Folder.id == folder_id,
        Folder.user_id == current_user.id
    )

    if include_children:
        query = query.options(selectinload(Folder.children))

    result = await db.execute(query)
    folder = result.scalar_one_or_none()

    if folder is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Folder not found"
        )

    if include_children:
        return FolderResponse(**folder.to_dict(include_children=True))

    return folder


@router.put("/{folder_id}", response_model=FolderResponse)
async def update_folder(
    folder_id: str,
    folder_data: FolderUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update a folder.

    Args:
        folder_id: Folder ID
        folder_data: Updated folder data
        current_user: Current authenticated user
        db: Database session

    Returns:
        FolderResponse: Updated folder

    Raises:
        HTTPException: If folder not found or validation fails
    """
    # Get folder
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id,
            Folder.user_id == current_user.id
        )
    )
    folder = result.scalar_one_or_none()

    if folder is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Folder not found"
        )

    # Check for circular reference if parent_id is being changed
    if folder_data.parent_id is not None and folder_data.parent_id != folder.parent_id:
        is_circular = await check_circular_reference(db, folder_id, folder_data.parent_id)
        if is_circular:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot move folder: would create circular reference"
            )

    # Update fields
    update_data = folder_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(folder, field, value)

    await db.commit()
    await db.refresh(folder)

    return folder


@router.patch("/{folder_id}/move", response_model=FolderResponse)
async def move_folder(
    folder_id: str,
    move_data: FolderMove,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Move a folder to a new parent and/or position.

    Args:
        folder_id: Folder ID to move
        move_data: New parent and position
        current_user: Current authenticated user
        db: Database session

    Returns:
        FolderResponse: Moved folder

    Raises:
        HTTPException: If validation fails
    """
    # Get folder
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id,
            Folder.user_id == current_user.id
        )
    )
    folder = result.scalar_one_or_none()

    if folder is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Folder not found"
        )

    # Check for circular reference
    is_circular = await check_circular_reference(db, folder_id, move_data.parent_id)
    if is_circular:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot move folder: would create circular reference"
        )

    # Update parent and position
    folder.parent_id = move_data.parent_id
    folder.position = move_data.position or 0

    await db.commit()
    await db.refresh(folder)

    return folder


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a folder and all its contents.

    Args:
        folder_id: Folder ID
        current_user: Current authenticated user
        db: Database session

    Raises:
        HTTPException: If folder not found
    """
    # Get folder
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id,
            Folder.user_id == current_user.id
        )
    )
    folder = result.scalar_one_or_none()

    if folder is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Folder not found"
        )

    # Delete folder (cascade will handle children and bookmarks)
    await db.delete(folder)
    await db.commit()


@router.post("/bulk/delete", status_code=status.HTTP_204_NO_CONTENT)
async def bulk_delete_folders(
    delete_data: FolderBulkDelete,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete multiple folders at once.

    Args:
        delete_data: List of folder IDs to delete
        current_user: Current authenticated user
        db: Database session
    """
    await db.execute(
        delete(Folder).where(
            Folder.id.in_(delete_data.folder_ids),
            Folder.user_id == current_user.id
        )
    )
    await db.commit()


@router.post("/bulk/move", response_model=List[FolderResponse])
async def bulk_move_folders(
    move_data: FolderBulkMove,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Move multiple folders to a new parent.

    Args:
        move_data: List of folder IDs and target parent
        current_user: Current authenticated user
        db: Database session

    Returns:
        List[FolderResponse]: Updated folders

    Raises:
        HTTPException: If any validation fails
    """
    # Check for circular references
    for folder_id in move_data.folder_ids:
        is_circular = await check_circular_reference(
            db, folder_id, move_data.target_parent_id
        )
        if is_circular:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot move folder {folder_id}: would create circular reference"
            )

    # Update folders
    await db.execute(
        update(Folder)
        .where(
            Folder.id.in_(move_data.folder_ids),
            Folder.user_id == current_user.id
        )
        .values(parent_id=move_data.target_parent_id)
    )
    await db.commit()

    # Return updated folders
    result = await db.execute(
        select(Folder).where(
            Folder.id.in_(move_data.folder_ids),
            Folder.user_id == current_user.id
        )
    )
    folders = result.scalars().all()

    return folders
