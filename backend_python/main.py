"""Main FastAPI application for VisuaLex Backend."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from config import settings
from database import init_db, close_db
from routes import auth

# Import future routers here
from routes import folders
# from routes import bookmarks, annotations, highlights, dossiers, sync


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan events.
    Initialize database on startup and close connections on shutdown.
    """
    # Startup
    await init_db()
    print("✅ Database initialized")
    yield
    # Shutdown
    await close_db()
    print("👋 Database connections closed")


# Create FastAPI app
app = FastAPI(
    title="VisuaLex API",
    description="Backend API for VisuaLex legal research platform",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api")
app.include_router(folders.router, prefix="/api")

# Future routers
# app.include_router(bookmarks.router, prefix="/api")
# app.include_router(annotations.router, prefix="/api")
# app.include_router(highlights.router, prefix="/api")
# app.include_router(dossiers.router, prefix="/api")
# app.include_router(sync.router, prefix="/api")


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "visualex-backend",
        "version": "1.0.0"
    }


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "message": "VisuaLex Backend API",
        "docs": "/api/docs",
        "health": "/api/health",
        "version": "1.0.0"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.environment == "development"
    )
