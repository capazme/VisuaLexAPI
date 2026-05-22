"""
Database Connection Manager for Live Enrichment
================================================

Async PostgreSQL connection pool using SQLAlchemy 2.0 + asyncpg.

Usage:
    from merlt.storage.enrichment.database import get_db_session, init_db

    # Initialize engine (once at startup)
    await init_db()

    # Use session in endpoints
    async with get_db_session() as session:
        entity = await session.get(PendingEntity, entity_id)
        await session.commit()
"""

import os
import structlog
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    AsyncEngine,
    async_sessionmaker,
)
from sqlalchemy.pool import NullPool, AsyncAdaptedQueuePool

from merlt.storage.enrichment.models import Base

log = structlog.get_logger()

# Global engine and session factory
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_database_url() -> str:
    """
    Get database URL from environment.

    Supports:
    - ENRICHMENT_DATABASE_URL (full URL)
    - Individual components: ENRICHMENT_DB_HOST, _PORT, _NAME, _USER, _PASSWORD

    Returns:
        PostgreSQL asyncpg URL

    Example:
        postgresql+asyncpg://dev:devpassword@localhost:5436/rlcf_dev
    """
    # Try full URL first
    db_url = os.getenv("ENRICHMENT_DATABASE_URL")
    if db_url:
        # Convert psycopg2 URL to asyncpg if needed
        if "postgresql://" in db_url and "+asyncpg" not in db_url:
            db_url = db_url.replace("postgresql://", "postgresql+asyncpg://")
        return db_url

    # Build from components
    host = os.getenv("ENRICHMENT_DB_HOST", "localhost")
    port = os.getenv("ENRICHMENT_DB_PORT", "5433")
    database = os.getenv("ENRICHMENT_DB_NAME", "rlcf_dev")
    user = os.getenv("ENRICHMENT_DB_USER", "dev")
    password = os.getenv("ENRICHMENT_DB_PASSWORD", "devpassword")

    return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{database}"


async def init_db(
    database_url: str | None = None,
    echo: bool = False,
    pool_size: int = 10,
    max_overflow: int = 20,
) -> AsyncEngine:
    """
    Initialize database engine and session factory.

    Call this once at application startup.

    Args:
        database_url: Optional override for DB URL
        echo: Whether to log SQL statements (default: False)
        pool_size: Connection pool size (default: 10)
        max_overflow: Max overflow connections (default: 20)

    Returns:
        AsyncEngine instance

    Example:
        # In FastAPI startup
        @app.on_event("startup")
        async def startup():
            await init_db(echo=True)  # Enable SQL logging in dev
    """
    global _engine, _session_factory

    if _engine is not None:
        log.warning("Database engine already initialized, skipping")
        return _engine

    url = database_url or get_database_url()

    # Create engine with asyncpg
    _engine = create_async_engine(
        url,
        echo=echo,
        pool_pre_ping=True,  # Verify connections before use
        pool_size=pool_size,
        max_overflow=max_overflow,
        poolclass=AsyncAdaptedQueuePool,
    )

    # Create session factory
    _session_factory = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,  # Allow access to objects after commit
        autocommit=False,
        autoflush=False,
    )

    log.info("Database engine initialized", url=url.split("@")[1] if "@" in url else url)
    return _engine


async def create_tables():
    """
    Create all tables defined in models.

    WARNING: This will NOT run migrations. Use migration script instead.

    Use this only for:
    - Fresh database setup
    - Testing with temporary databases

    For production, use migrations/001_live_enrichment_schema.sql
    """
    global _engine

    if _engine is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")

    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    log.info("Database tables created")


async def drop_tables():
    """
    Drop all tables.

    WARNING: Destructive operation. Use only for testing.
    """
    global _engine

    if _engine is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")

    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    log.warning("All database tables dropped")


async def close_db():
    """
    Close database connections.

    Call this at application shutdown.

    Example:
        @app.on_event("shutdown")
        async def shutdown():
            await close_db()
    """
    global _engine, _session_factory

    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
        log.info("Database connections closed")


@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Get database session (context manager).

    Usage:
        async with get_db_session() as session:
            entity = PendingEntity(...)
            session.add(entity)
            await session.commit()

    Session is automatically rolled back on exception.
    """
    global _session_factory

    if _session_factory is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")

    async with _session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception as e:
            await session.rollback()
            log.error("Database session error, rolled back", error=str(e))
            raise
        finally:
            await session.close()


async def get_db_session_dependency():
    """
    Dependency for FastAPI endpoints.

    Usage:
        @router.post("/entities")
        async def create_entity(
            session: AsyncSession = Depends(get_db_session_dependency)
        ):
            entity = PendingEntity(...)
            session.add(entity)
            await session.commit()
            return entity
    """
    global _session_factory

    if _session_factory is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")

    async with _session_factory() as session:
        try:
            yield session
        except Exception as e:
            await session.rollback()
            log.error("Database session error, rolled back", error=str(e))
            raise
        finally:
            await session.close()


# ====================================================
# HEALTH CHECK
# ====================================================
async def check_db_health() -> bool:
    """
    Check if database is accessible.

    Returns:
        True if healthy, False otherwise

    Example:
        is_healthy = await check_db_health()
        if not is_healthy:
            raise RuntimeError("Database unhealthy")
    """
    global _engine

    if _engine is None:
        return False

    try:
        async with _engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        log.error("Database health check failed", error=str(e))
        return False


# ====================================================
# EXPORTS
# ====================================================
__all__ = [
    "init_db",
    "close_db",
    "create_tables",
    "drop_tables",
    "get_db_session",
    "get_db_session_dependency",
    "check_db_health",
    "get_database_url",
]
