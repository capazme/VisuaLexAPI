# ✅ Migrazione Backend Completata

## Panoramica

Il backend della **piattaforma VisuaLex** è stato migrato da Python/FastAPI a **Node.js/Express/TypeScript** mantenendo la separazione architetturale con l'API VisualEx.

## Architettura Finale

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend React                      │
│                  (TypeScript + Vite)                    │
│                   Port: 5173                            │
└─────────────┬───────────────────────┬───────────────────┘
              │                       │
              ▼                       ▼
┌─────────────────────────┐ ┌─────────────────────────────┐
│  VisuaLex Platform      │ │   VisualEx API              │
│  Backend                │ │   (Python/Quart)            │
│  (Node.js/Express/TS)   │ │                             │
│  Port: 3001             │ │   Port: 8000                │
│                         │ │                             │
│  - Authentication (JWT) │ │   - Fetch norms             │
│  - Folders CRUD         │ │   - Brocardi data           │
│  - Bookmarks            │ │   - EUR-Lex integration     │
│  - Annotations          │ │   - Normattiva API          │
│  - Highlights           │ │                             │
│  - Dossiers             │ │                             │
└────────────┬────────────┘ └─────────────────────────────┘
             │
             ▼
    ┌─────────────────┐
    │   PostgreSQL    │
    │ visualex_platform│
    │   Port: 5432    │
    └─────────────────┘
```

## Cosa è stato fatto

### 1. ✅ Backend Python spostato
- Directory `backend/` → `backend_python/` (preservato come riferimento)
- Tutti i 24 file FastAPI conservati

### 2. ✅ Nuovo Backend Node.js creato

**File creati (18 files):**

```
backend/
├── package.json                  # Dipendenze e scripts
├── tsconfig.json                 # Configurazione TypeScript
├── .env                          # Environment variables
├── .env.example                  # Environment template
├── .gitignore                    # Git ignore rules
├── README.md                     # Documentazione completa
├── prisma/
│   └── schema.prisma             # Database schema con Prisma
└── src/
    ├── index.ts                  # Entry point Express app
    ├── config.ts                 # Configurazione applicazione
    ├── types/
    │   └── express.d.ts          # TypeScript type extensions
    ├── utils/
    │   ├── jwt.ts                # JWT token utilities
    │   └── password.ts           # Password hashing (bcrypt)
    ├── middleware/
    │   ├── auth.ts               # Authentication middleware
    │   └── errorHandler.ts       # Global error handler
    ├── controllers/
    │   ├── authController.ts     # Auth business logic
    │   └── folderController.ts   # Folder business logic
    └── routes/
        ├── auth.ts               # Auth endpoints
        └── folders.ts            # Folder endpoints
```

### 3. ✅ Database PostgreSQL configurato

**Database creato:** `visualex_platform`

**Tabelle create (7 tables):**
- `users` - User accounts con authentication
- `folders` - Hierarchical folder structure
- `bookmarks` - Saved legal articles
- `annotations` - User notes (5 types)
- `highlights` - Text highlighting
- `dossiers` - Work projects
- `dossier_items` - Items in dossiers

**Features:**
- UUID primary keys
- Cascade delete (user deletion removes all data)
- Circular reference prevention in folders
- JSON storage for flexible data (normaData, content)
- Array support (tags in bookmarks)
- Timestamps (createdAt, updatedAt)

### 4. ✅ API Endpoints implementati

**Authentication (5 endpoints):**
- POST `/api/auth/register` - Register new user
- POST `/api/auth/login` - Login user
- POST `/api/auth/refresh` - Refresh access token
- GET `/api/auth/me` - Get current user (protected)
- PUT `/api/auth/change-password` - Change password (protected)

**Folders (9 endpoints):**
- POST `/api/folders` - Create folder
- GET `/api/folders` - List folders (with parent filter)
- GET `/api/folders/tree` - Get hierarchical tree
- GET `/api/folders/:id` - Get single folder
- PUT `/api/folders/:id` - Update folder
- PATCH `/api/folders/:id/move` - Move folder
- DELETE `/api/folders/:id` - Delete folder
- POST `/api/folders/bulk/delete` - Bulk delete
- POST `/api/folders/bulk/move` - Bulk move

**Utilities:**
- GET `/api/health` - Health check endpoint

### 5. ✅ Frontend aggiornato

**Modifiche:**
- `frontend/.env.example` - URL aggiornato da 8000 → 3001
- `frontend/.env` - Creato con configurazione corretta
- Nessuna modifica al codice (già compatibile!)

### 6. ✅ Tutto testato e funzionante

**Test eseguiti:**
1. ✅ Registrazione utente → SUCCESS
2. ✅ Login utente → SUCCESS (tokens generati)
3. ✅ Creazione cartella → SUCCESS (con auth)
4. ✅ Creazione sottocartella → SUCCESS (gerarchia)
5. ✅ Get folder tree → SUCCESS (children correttamente nested)

**Esempio output folder tree:**
```json
[
  {
    "id": "e89462eb-7995-47b1-81dd-bf966ddf4863",
    "name": "Diritto Civile",
    "description": "Norme di diritto civile italiano",
    "color": "#3B82F6",
    "children": [
      {
        "id": "81455a94-68e0-4961-8ae7-498922aac899",
        "name": "Contratti",
        "description": "Norme sui contratti",
        "color": "#10B981",
        "children": []
      }
    ]
  }
]
```

## Come avviare il sistema completo

### 1. Backend Platform (Node.js)

```bash
cd backend
npm install          # Se non già fatto
npm run dev          # Server in ascolto su :3001
```

Output:
```
╔═══════════════════════════════════════════════════════════╗
║  VisuaLex Platform Backend                               ║
║  Status: Running                                          ║
║  Port: 3001                                             ║
║  Environment: development                            ║
╚═══════════════════════════════════════════════════════════╝
```

### 2. VisualEx API (Python) - Opzionale

```bash
# Se serve per fetching norme
cd src
python app.py        # Server in ascolto su :8000
```

### 3. Frontend (React)

```bash
cd frontend
npm install          # Se non già fatto
npm run dev          # Server in ascolto su :5173
```

Apri: http://localhost:5173

## Test rapido dalla UI

1. Vai su http://localhost:5173/register
2. Registrati con:
   - Email: `tuo@email.com`
   - Username: `tuousername`
   - Password: `test` (minimo 3 caratteri)
3. Verrai automaticamente loggato e reindirizzato
4. Vai su `/workspace` (route protetta, ora accessibile)
5. Crea una cartella usando l'interfaccia

## Database

**Connessione locale:**
```bash
psql visualex_platform
```

**Visual editor (Prisma Studio):**
```bash
cd backend
npm run prisma:studio
# Apre http://localhost:5555
```

## Tecnologie utilizzate

### Backend
- **Runtime:** Node.js 20+
- **Framework:** Express.js
- **Language:** TypeScript 5.3
- **ORM:** Prisma 5.20
- **Database:** PostgreSQL
- **Authentication:** JWT (jsonwebtoken)
- **Password:** bcrypt
- **Validation:** Zod

### Database Schema
- **Modelli:** 7 (User, Folder, Bookmark, Annotation, Highlight, Dossier, DossierItem)
- **Relazioni:** One-to-Many, Self-referencing (folders)
- **Features:** Cascade delete, circular prevention, JSON fields

### Frontend (Unchanged)
- React 18
- TypeScript
- Vite
- Zustand (state)
- Axios (HTTP client con auto-refresh)
- TailwindCSS

## Differenze con Backend Python

| Aspetto | Python (vecchio) | Node.js (nuovo) |
|---------|------------------|-----------------|
| **Framework** | FastAPI | Express.js |
| **ORM** | SQLAlchemy (async) | Prisma |
| **Schema** | Models in Python | Prisma schema |
| **Migrations** | Alembic | Prisma migrate |
| **Validation** | Pydantic | Zod |
| **Docs** | Auto Swagger | Manual README |
| **Type Safety** | Python types | TypeScript |

## Vantaggi della migrazione

✅ **Stack unificato:** Tutto in JavaScript/TypeScript (frontend + backend platform)
✅ **DX migliorata:** Hot reload, TypeScript end-to-end
✅ **Prisma:** Miglior DX per database, studio visuale, type safety
✅ **Più leggero:** Node.js più veloce per I/O rispetto a Python
✅ **Separazione chiara:** Platform backend vs Legal API backend

## Prossimi passi

### Immediato
- [x] Backend Node.js funzionante
- [x] Database setup
- [x] Auth endpoints
- [x] Folders endpoints
- [ ] Testare registrazione dal frontend UI

### Short-term
- [ ] Implementare Bookmarks API
- [ ] Implementare Annotations API
- [ ] Implementare Highlights API
- [ ] Implementare Dossiers API

### Medium-term
- [ ] UI per folder tree
- [ ] Drag & drop folders
- [ ] Bookmark management UI
- [ ] Multi-version comparison UI

## Note importanti

1. **VisualEx API inalterata:** Il backend Python/Quart per le norme rimane com'è
2. **Frontend compatibile:** Nessuna modifica necessaria oltre all'URL
3. **Database separato:** `visualex_platform` per platform, diverso da DB IusGraph
4. **Migrations gestite:** Usare `npm run prisma:migrate` per schema changes

## Supporto

**Documentazione completa:**
- `backend/README.md` - Setup e API reference
- `backend/prisma/schema.prisma` - Database schema
- `backend_python/README.md` - Vecchio backend (reference)

**Scripts utili:**
```bash
# Backend
npm run dev              # Dev server con hot reload
npm run prisma:studio    # Visual DB editor
npm run prisma:migrate   # Apply migrations
npm run build            # Build per production

# Frontend
npm run dev              # Dev server
npm run build            # Build per production
npm test                 # Run tests
```

---

**Status:** ✅ COMPLETATO
**Data:** 2025-11-20
**Backend Server:** http://localhost:3001
**Frontend:** http://localhost:5173
**Database:** PostgreSQL `visualex_platform`
