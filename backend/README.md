# VisuaLex Platform Backend

Node.js/Express/TypeScript backend for the VisuaLex platform - handles user authentication, document organization, and data persistence.

## Architecture

**Stack:**
- **Runtime:** Node.js
- **Framework:** Express.js
- **Language:** TypeScript
- **ORM:** Prisma
- **Database:** PostgreSQL
- **Authentication:** JWT (Access + Refresh tokens)
- **Validation:** Zod

**Separation of Concerns:**
- This backend handles **platform features** (users, folders, bookmarks, annotations)
- The **VisualEx API** (Python/Quart) handles **legal data fetching** (norms, articles, Brocardi)
- Frontend calls both backends as needed

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Setup Database

Create a PostgreSQL database:

```bash
createdb visualex_platform
```

Or use an existing database by updating `DATABASE_URL` in `.env`.

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set your values:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/visualex_platform"
JWT_SECRET="your-secret-key-change-in-production"
PORT=3001
```

### 4. Generate Prisma Client & Run Migrations

```bash
npm run prisma:generate
npm run prisma:migrate
```

This will:
- Generate the Prisma Client
- Create database tables based on `prisma/schema.prisma`
- Apply all migrations

### 5. Start Development Server

```bash
npm run dev
```

Server will start at `http://localhost:3001`

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build TypeScript to JavaScript |
| `npm start` | Run production server (requires build first) |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Run database migrations |
| `npm run prisma:studio` | Open Prisma Studio (visual DB editor) |
| `npm run prisma:reset` | Reset database (⚠️ deletes all data) |
| `npm run db:seed` | Seed database with test data |

## API Endpoints

### Health Check
```
GET /api/health
```

### Authentication

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/register` | Register new user | No |
| POST | `/api/auth/login` | Login user | No |
| POST | `/api/auth/refresh` | Refresh access token | No |
| GET | `/api/auth/me` | Get current user | Yes |
| PUT | `/api/auth/change-password` | Change password | Yes |

#### Register Example
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "user@example.com",
    "username": "testuser",
    "password": "password123"
  }'
```

Response:
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "token_type": "Bearer",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "testuser",
    "is_active": true,
    "is_verified": false,
    "created_at": "2025-01-20T..."
  }
}
```

#### Login Example
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### Folders

All folder endpoints require authentication (`Authorization: Bearer <token>`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/folders` | Create folder |
| GET | `/api/folders` | List folders (flat) |
| GET | `/api/folders/tree` | Get folder tree |
| GET | `/api/folders/:id` | Get single folder |
| PUT | `/api/folders/:id` | Update folder |
| PATCH | `/api/folders/:id/move` | Move folder |
| DELETE | `/api/folders/:id` | Delete folder |
| POST | `/api/folders/bulk/delete` | Bulk delete |
| POST | `/api/folders/bulk/move` | Bulk move |

#### Create Folder Example
```bash
curl -X POST http://localhost:3001/api/folders \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Diritto Civile",
    "description": "Norme di diritto civile",
    "color": "#3B82F6",
    "icon": "folder"
  }'
```

#### Get Folder Tree Example
```bash
curl -X GET http://localhost:3001/api/folders/tree \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN'
```

Response:
```json
[
  {
    "id": "uuid",
    "name": "Diritto Civile",
    "description": "Norme di diritto civile",
    "color": "#3B82F6",
    "icon": "folder",
    "position": 0,
    "parentId": null,
    "userId": "uuid",
    "createdAt": "2025-01-20T...",
    "updatedAt": "2025-01-20T...",
    "children": [
      {
        "id": "uuid",
        "name": "Contratti",
        "children": []
      }
    ]
  }
]
```

## Database Schema

See `prisma/schema.prisma` for the complete database schema.

**Core Models:**
- `User` - User accounts with authentication
- `Folder` - Hierarchical folder structure (adjacency list)
- `Bookmark` - Saved legal articles with flexible JSON storage
- `Annotation` - User notes on articles (5 types: note, question, important, follow_up, summary)
- `Highlight` - Text highlighting with colors
- `Dossier` - Work folders/projects
- `DossierItem` - Items within dossiers (norms, notes, sections)

**Key Features:**
- Cascade delete: Deleting a user deletes all their data
- Circular reference prevention: Cannot move folder into its own subtree
- Flexible JSON storage: `normaData` in Bookmark for complete article data
- Array support: Tags in Bookmark

## Development

### View Database with Prisma Studio

```bash
npm run prisma:studio
```

Opens visual database editor at `http://localhost:5555`

### Reset Database

⚠️ **Warning:** This deletes all data!

```bash
npm run prisma:reset
```

### Create New Migration

After modifying `prisma/schema.prisma`:

```bash
npx prisma migrate dev --name description_of_changes
```

## Frontend Integration

The React frontend is configured to call this backend via axios client at `frontend/src/services/api.ts`.

**Frontend setup:**
1. Ensure `frontend/.env` has `VITE_API_URL=http://localhost:3001/api`
2. Frontend automatically adds `Authorization: Bearer <token>` header
3. Auto-refresh on 401 errors using refresh token

## Production Deployment

### Build

```bash
npm run build
```

Output in `dist/` folder.

### Run Production

```bash
NODE_ENV=production npm start
```

### Environment Variables (Production)

Set these in your production environment:

```env
DATABASE_URL="postgresql://user:password@host:5432/db"
JWT_SECRET="strong-random-secret"
PORT=3001
NODE_ENV="production"
ALLOWED_ORIGINS="https://your-frontend.com"
```

### Database Migrations (Production)

```bash
npx prisma migrate deploy
```

Use `migrate deploy` (not `migrate dev`) in production - it applies migrations without prompting.

## Troubleshooting

### "Cannot find module '@prisma/client'"

Run:
```bash
npm run prisma:generate
```

### Database connection error

Check:
1. PostgreSQL is running: `pg_isready`
2. Database exists: `psql -l | grep visualex_platform`
3. Credentials in `.env` are correct

### Port already in use

Change `PORT` in `.env` or kill the process:
```bash
lsof -ti:3001 | xargs kill
```

## License

ISC
