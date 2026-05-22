"""
Database configuration for RLCF Framework.

Provides SQLAlchemy base class and session management for
RLCF models (Tasks, Feedback, Users, etc.).

Supports both sync and async sessions:
- Sync: get_session() for simple scripts
- Async: get_async_session() for production/async code

References:
    RLCF.md Section 4 - Data Storage
    docs/02-methodology/rlcf/technical/database-schema.md
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from typing import Optional, AsyncGenerator
from contextlib import asynccontextmanager
import os

# SQLAlchemy declarative base for all RLCF models
Base = declarative_base()

# Database URLs from environment (no hardcoded credentials)
DEFAULT_DATABASE_URL = os.environ.get("RLCF_DATABASE_URL", "postgresql://dev:devpassword@localhost:5436/rlcf_dev")
DEFAULT_ASYNC_DATABASE_URL = os.environ.get("RLCF_ASYNC_DATABASE_URL", os.environ.get("RLCF_DATABASE_URL", "postgresql+asyncpg://dev:devpassword@localhost:5436/rlcf_dev").replace("postgresql://", "postgresql+asyncpg://"))
DEFAULT_POSTGRES_URL = DEFAULT_ASYNC_DATABASE_URL

# Module-level engine and session factory (sync)
_engine = None
_SessionLocal = None

# Module-level async engine and session factory
_async_engine = None
_AsyncSessionLocal = None


def get_database_url() -> str:
    """
    Get database URL from environment or use default.

    Returns:
        Database connection URL
    """
    return os.environ.get("RLCF_DATABASE_URL", DEFAULT_DATABASE_URL)


def get_async_database_url() -> str:
    """
    Get async database URL from environment or use default.

    For PostgreSQL: postgresql+asyncpg://user:pass@host:port/db
    For SQLite: sqlite+aiosqlite:///path/to/db.sqlite

    Returns:
        Async database connection URL
    """
    url = os.environ.get("RLCF_ASYNC_DATABASE_URL")
    if url:
        return url

    # Check if PostgreSQL is configured
    pg_url = os.environ.get("RLCF_POSTGRES_URL")
    if pg_url:
        return pg_url

    return DEFAULT_ASYNC_DATABASE_URL


def init_db(database_url: Optional[str] = None) -> None:
    """
    Initialize database engine and create all tables.

    Args:
        database_url: Optional database URL override
    """
    global _engine, _SessionLocal

    url = database_url or get_database_url()
    # Use NullPool in test mode to avoid connection leaks across event loops
    pool_kwargs = {}
    if os.environ.get("MERLT_ENV") == "test":
        pool_kwargs["poolclass"] = NullPool
    _engine = create_engine(url, echo=False, **pool_kwargs)
    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    # Create all tables
    # For SQLite: create tables individually, skipping those with
    # PostgreSQL-only types (e.g. JSONB, ARRAY)
    if "sqlite" in url:
        for table in Base.metadata.sorted_tables:
            try:
                table.create(_engine, checkfirst=True)
            except Exception:
                pass
    else:
        Base.metadata.create_all(bind=_engine)


async def init_async_db(database_url: Optional[str] = None) -> None:
    """
    Initialize async database engine and create all tables.

    Args:
        database_url: Optional async database URL override

    Example:
        >>> await init_async_db("postgresql+asyncpg://user:pass@localhost/db")
    """
    global _async_engine, _AsyncSessionLocal

    url = database_url or get_async_database_url()

    # Use NullPool in test mode to avoid connection leaks across event loops
    pool_kwargs = {}
    if os.environ.get("MERLT_ENV") == "test":
        pool_kwargs["poolclass"] = NullPool
    _async_engine = create_async_engine(url, echo=False, **pool_kwargs)
    _AsyncSessionLocal = async_sessionmaker(
        bind=_async_engine,
        class_=AsyncSession,
        expire_on_commit=False
    )

    # Create all tables (need to run sync for metadata)
    # For SQLite: create tables individually, skipping those with
    # PostgreSQL-only types (e.g. JSONB, ARRAY) that can't be rendered
    async with _async_engine.begin() as conn:
        if "sqlite" in url:
            def _create_tables_individually(sync_conn):
                for table in Base.metadata.sorted_tables:
                    try:
                        table.create(sync_conn, checkfirst=True)
                    except Exception:
                        pass  # Skip tables with incompatible types
            await conn.run_sync(_create_tables_individually)
        else:
            await conn.run_sync(Base.metadata.create_all)


def get_session():
    """
    Get a sync database session.

    Yields:
        Database session that auto-closes

    Raises:
        RuntimeError: If database not initialized
    """
    if _SessionLocal is None:
        init_db()

    session = _SessionLocal()
    try:
        yield session
    finally:
        session.close()


@asynccontextmanager
async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Get an async database session (context manager version).

    Example:
        >>> async with get_async_session() as session:
        ...     result = await session.execute(select(User))

    Yields:
        AsyncSession that auto-closes

    Raises:
        RuntimeError: If async database not initialized
    """
    global _AsyncSessionLocal

    if _AsyncSessionLocal is None:
        await init_async_db()

    async with _AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def get_async_session_dep() -> AsyncGenerator[AsyncSession, None]:
    """
    Get an async database session (for FastAPI Depends).

    This is a plain async generator (not a context manager) suitable
    for use with FastAPI's Depends() injection.

    Example:
        >>> @router.get("/endpoint")
        >>> async def endpoint(session: AsyncSession = Depends(get_async_session_dep)):
        ...     result = await session.execute(select(User))

    Yields:
        AsyncSession that auto-closes

    Raises:
        RuntimeError: If async database not initialized
    """
    global _AsyncSessionLocal

    if _AsyncSessionLocal is None:
        await init_async_db()

    async with _AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def get_engine():
    """
    Get the database engine.

    Returns:
        SQLAlchemy engine

    Raises:
        RuntimeError: If database not initialized
    """
    if _engine is None:
        init_db()
    return _engine


def get_async_engine():
    """
    Get the async database engine.

    Returns:
        SQLAlchemy async engine

    Note:
        Call init_async_db() first if not yet initialized
    """
    return _async_engine
