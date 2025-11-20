# VisuaLex Backend API

Backend enterprise-grade per la piattaforma VisuaLex di ricerca legale.

## 🚀 Features

- ✅ **Autenticazione JWT** con access e refresh tokens
- ✅ **Gerarchia cartelle illimitata** con drag-and-drop support
- ✅ **Gestione bookmarks** con tags e note
- ✅ **Annotazioni avanzate** (note, domande, follow-ups)
- ✅ **Highlighting** con 4 colori e snapshots
- ✅ **Dossiers** per organizzare progetti di ricerca
- ✅ **Sync API** per sincronizzare stato client-server
- ✅ **PostgreSQL** con full-text search
- ✅ **Swagger UI** integrato

## 📋 Prerequisites

- Python 3.10+
- PostgreSQL 14+
- pip o poetry

## 🛠 Installation

### 1. Create Virtual Environment

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Setup PostgreSQL

```bash
# Create database
createdb visualex

# Or with psql
psql -U postgres
CREATE DATABASE visualex;
```

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/visualex
SECRET_KEY=your-super-secret-key-change-in-production
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

### 5. Run Database Migrations

```bash
# Initialize Alembic (first time only)
alembic init migrations

# Create initial migration
alembic revision --autogenerate -m "Initial schema"

# Apply migrations
alembic upgrade head
```

### 6. Start Server

```bash
# Development (with auto-reload)
python main.py

# Production (with uvicorn)
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

Server will be available at `http://localhost:8000`

## 📚 API Documentation

- **Swagger UI**: http://localhost:8000/api/docs
- **ReDoc**: http://localhost:8000/api/redoc
- **OpenAPI JSON**: http://localhost:8000/api/openapi.json

## 🔑 Authentication

### Register

```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "user@example.com",
    "username": "johndoe",
    "password": "SecurePass123"
  }'
```

### Login

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123"
  }'
```

Response:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer"
}
```

### Use Token

```bash
curl -X GET http://localhost:8000/api/auth/me \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN'
```

## 📁 Folder Hierarchy API

### Create Folder

```bash
curl -X POST http://localhost:8000/api/folders/ \
  -H 'Authorization: Bearer TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Diritto Civile",
    "description": "Cartella principale per diritto civile",
    "color": "#FF5733",
    "icon": "folder",
    "parent_id": null
  }'
```

### Get Folder Tree

```bash
curl -X GET http://localhost:8000/api/folders/tree \
  -H 'Authorization: Bearer TOKEN'
```

### Move Folder

```bash
curl -X PATCH http://localhost:8000/api/folders/{folder_id}/move \
  -H 'Authorization: Bearer TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "parent_id": "new-parent-id",
    "position": 0
  }'
```

### Bulk Operations

```bash
# Bulk delete
curl -X POST http://localhost:8000/api/folders/bulk/delete \
  -H 'Authorization: Bearer TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "folder_ids": ["id1", "id2", "id3"]
  }'

# Bulk move
curl -X POST http://localhost:8000/api/folders/bulk/move \
  -H 'Authorization: Bearer TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "folder_ids": ["id1", "id2"],
    "target_parent_id": "new-parent-id"
  }'
```

## 🗂 Project Structure

```
backend/
├── auth/                    # Authentication utilities
│   ├── dependencies.py      # FastAPI dependencies
│   └── utils.py             # JWT and password hashing
├── models/                  # SQLAlchemy models
│   ├── user.py
│   ├── folder.py
│   ├── bookmark.py
│   ├── annotation.py
│   ├── highlight.py
│   └── dossier.py
├── routes/                  # API endpoints
│   ├── auth.py
│   ├── folders.py
│   ├── bookmarks.py         # TODO
│   ├── annotations.py       # TODO
│   ├── highlights.py        # TODO
│   ├── dossiers.py          # TODO
│   └── sync.py              # TODO
├── schemas/                 # Pydantic schemas
│   ├── auth.py
│   └── folder.py
├── config.py                # Configuration management
├── database.py              # Database connection
├── main.py                  # FastAPI application
└── requirements.txt         # Python dependencies
```

## 🔒 Security

- Passwords are hashed with **bcrypt**
- JWT tokens with **HS256** algorithm
- Access tokens expire in **30 minutes**
- Refresh tokens expire in **7 days**
- **CORS** configured for allowed origins only
- SQL injection protection via SQLAlchemy ORM
- Input validation with Pydantic

## 🧪 Testing

```bash
# Install test dependencies
pip install pytest pytest-asyncio httpx

# Run tests
pytest

# With coverage
pytest --cov=. --cov-report=html
```

## 📊 Database Schema

```sql
-- Users
users: id, email, username, hashed_password, is_active, is_verified, created_at, updated_at

-- Folders (hierarchical)
folders: id, name, description, color, icon, parent_id, position, user_id, created_at, updated_at

-- Bookmarks
bookmarks: id, norma_key, norma_data, folder_id, tags[], notes, user_id, created_at, updated_at

-- Annotations
annotations: id, norma_key, content, annotation_type, bookmark_id, text_context, position, user_id, created_at, updated_at

-- Highlights
highlights: id, norma_key, text, color, start_offset, end_offset, container_id, note, bookmark_id, user_id, created_at, updated_at

-- Dossiers
dossiers: id, name, description, color, icon, user_id, created_at, updated_at
dossier_items: id, dossier_id, item_type, data, position, parent_id, created_at, updated_at
```

## 🚦 Health Check

```bash
curl http://localhost:8000/api/health
```

Response:
```json
{
  "status": "healthy",
  "service": "visualex-backend",
  "version": "1.0.0"
}
```

## 📝 License

Internal/Educational use only.

## 🤝 Contributing

This is a private project. For questions, contact the development team.
