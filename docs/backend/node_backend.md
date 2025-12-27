# Node.js Platform Backend

The Node.js backend is an Express.js server providing platform services: user authentication, bookmarks, annotations, highlights, dossiers, and search history. It uses PostgreSQL with Prisma ORM.

**Server Port:** 3001

---

## Setup

### Requirements

- **Node.js 18+**
- **PostgreSQL** database

### Installation

```bash
cd backend
npm install
```

### Environment Configuration

Copy the example file and configure:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `JWT_SECRET` | Yes | - | Secret key for JWT signing (change in production!) |
| `JWT_ACCESS_EXPIRY` | No | `30m` | Access token TTL |
| `JWT_REFRESH_EXPIRY` | No | `7d` | Refresh token TTL |
| `PORT` | No | `3001` | Server port |
| `NODE_ENV` | No | `development` | Environment mode |
| `ALLOWED_ORIGINS` | No | `localhost:5173,localhost:3001` | CORS allowed origins (comma-separated) |

**Example `.env`:**
```env
DATABASE_URL="postgresql://visualex:visualex@localhost:5432/visualex_platform"
JWT_SECRET="your-secret-key-change-in-production"
JWT_ACCESS_EXPIRY="30m"
JWT_REFRESH_EXPIRY="7d"
PORT=3001
NODE_ENV="development"
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:3001"
```

### Database Setup

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# (Optional) Open Prisma Studio GUI
npm run prisma:studio
```

### Running the Server

```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm start
```

---

## NPM Scripts

| Script | Description |
|--------|-------------|
| `dev` | Run with tsx watch (hot reload) |
| `build` | Compile TypeScript to dist/ |
| `start` | Run compiled server |
| `prisma:generate` | Generate Prisma client |
| `prisma:migrate` | Create and run migrations |
| `prisma:studio` | Open Prisma Studio (port 5555) |
| `prisma:reset` | Reset database (destructive!) |
| `db:seed` | Seed database with sample data |

---

## Database Schema

```mermaid
erDiagram
    User ||--o{ Folder : owns
    User ||--o{ Bookmark : owns
    User ||--o{ Annotation : owns
    User ||--o{ Highlight : owns
    User ||--o{ Dossier : owns
    User ||--o{ Feedback : submits
    User ||--o{ SearchHistory : has

    Folder ||--o{ Folder : contains
    Folder ||--o{ Bookmark : contains

    Bookmark ||--o{ Annotation : has
    Bookmark ||--o{ Highlight : has

    Dossier ||--o{ DossierItem : contains

    User {
        uuid id PK
        string email UK
        string username UK
        string password
        boolean isActive
        boolean isVerified
        boolean isAdmin
        int loginCount
        datetime lastLoginAt
        datetime createdAt
        datetime updatedAt
    }

    Folder {
        uuid id PK
        string name
        string description
        string color
        string icon
        int position
        uuid parentId FK
        uuid userId FK
    }

    Bookmark {
        uuid id PK
        string normaKey
        json normaData
        string title
        string notes
        array tags
        uuid folderId FK
        uuid userId FK
    }

    Annotation {
        uuid id PK
        string normaKey
        string content
        enum annotationType
        string textContext
        int position
        uuid bookmarkId FK
        uuid userId FK
    }

    Highlight {
        uuid id PK
        string normaKey
        string text
        string color
        int startOffset
        int endOffset
        string note
        uuid bookmarkId FK
        uuid userId FK
    }

    Dossier {
        uuid id PK
        string name
        string description
        string color
        uuid userId FK
    }

    DossierItem {
        uuid id PK
        uuid dossierId FK
        enum itemType
        string title
        json content
        int position
    }

    Feedback {
        uuid id PK
        enum type
        string message
        enum status
        uuid userId FK
    }

    SearchHistory {
        uuid id PK
        string actType
        string actNumber
        string article
        string date
        string version
        uuid userId FK
    }
```

### Enums

**AnnotationType:** `note`, `question`, `important`, `follow_up`, `summary`

**DossierItemType:** `norm`, `note`, `section`

**FeedbackType:** `bug`, `suggestion`, `other`

**FeedbackStatus:** `new`, `read`, `resolved`, `dismissed`

---

## API Endpoints

All endpoints are prefixed with `/api`.

### Authentication (`/api/auth/*`)

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/auth/register` | No | User registration (creates inactive user) |
| POST | `/auth/login` | No | Login, returns access + refresh tokens |
| POST | `/auth/refresh` | No | Refresh access token |
| GET | `/auth/me` | Yes | Get current user |
| PUT | `/auth/change-password` | Yes | Change password |

#### POST `/auth/register`

```json
// Request
{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "securepassword"
}

// Response (201)
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "johndoe",
  "is_active": false,
  "is_admin": false
}
```

**Note:** New users are created with `isActive: false`. An admin must activate them.

#### POST `/auth/login`

```json
// Request
{
  "email": "user@example.com",
  "password": "securepassword"
}

// Response (200)
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "johndoe"
  }
}
```

---

### Admin (`/api/admin/*`)

All admin routes require authentication and admin privileges.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/users` | List all users with stats |
| POST | `/admin/users` | Create new user |
| GET | `/admin/users/:id` | Get user details |
| PUT | `/admin/users/:id` | Update user (email, username, status, admin) |
| DELETE | `/admin/users/:id` | Delete user (cascades all data) |
| POST | `/admin/users/:id/reset-password` | Reset user password |
| GET | `/admin/feedbacks` | List all feedback |
| GET | `/admin/feedbacks/stats` | Feedback statistics |
| PUT | `/admin/feedbacks/:id` | Update feedback status |
| DELETE | `/admin/feedbacks/:id` | Delete feedback |

---

### Bookmarks (`/api/bookmarks/*`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/bookmarks` | Create bookmark |
| GET | `/bookmarks` | List bookmarks (supports `?folderId=...` `?tags=...`) |
| GET | `/bookmarks/:id` | Get bookmark with annotations/highlights |
| PUT | `/bookmarks/:id` | Update bookmark |
| PATCH | `/bookmarks/:id/move` | Move to folder |
| DELETE | `/bookmarks/:id` | Delete bookmark |
| POST | `/bookmarks/bulk/delete` | Bulk delete |
| POST | `/bookmarks/bulk/move` | Bulk move to folder |

#### POST `/bookmarks`

```json
// Request
{
  "norma_key": "Art. 2043 c.c.",
  "norma_data": { "tipo_atto": "codice civile", ... },
  "title": "Tort Liability",
  "notes": "Important for civil law exam",
  "tags": ["civil", "torts"],
  "folder_id": "uuid"
}
```

---

### Folders (`/api/folders/*`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/folders` | Create folder |
| GET | `/folders` | List folders |
| GET | `/folders/tree` | Get folder hierarchy |
| GET | `/folders/:id` | Get folder |
| PUT | `/folders/:id` | Update folder |
| PATCH | `/folders/:id/move` | Move folder (with circular reference check) |
| DELETE | `/folders/:id` | Delete folder (cascades bookmarks) |
| POST | `/folders/bulk/delete` | Bulk delete |
| POST | `/folders/bulk/move` | Bulk move |

---

### Highlights (`/api/highlights/*`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/highlights` | Create highlight |
| GET | `/highlights` | Get highlights (supports `?normaKey=...`) |
| PUT | `/highlights/:id` | Update highlight |
| DELETE | `/highlights/:id` | Delete highlight |

#### POST `/highlights`

```json
{
  "norma_key": "Art. 2043 c.c.",
  "text": "danno ingiusto",
  "color": "yellow",
  "start_offset": 45,
  "end_offset": 59,
  "note": "Key concept"
}
```

**Colors:** `yellow`, `green`, `red`, `blue`

---

### Annotations (`/api/annotations/*`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/annotations` | Create annotation |
| GET | `/annotations` | Get annotations (supports `?normaKey=...` `?type=...`) |
| PUT | `/annotations/:id` | Update annotation |
| DELETE | `/annotations/:id` | Delete annotation |

**Types:** `note`, `question`, `important`, `follow_up`, `summary`

---

### Dossiers (`/api/dossiers/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dossiers` | List all dossiers with items |
| POST | `/dossiers` | Create dossier |
| GET | `/dossiers/:id` | Get dossier with items |
| PUT | `/dossiers/:id` | Update dossier |
| DELETE | `/dossiers/:id` | Delete dossier |
| POST | `/dossiers/:id/items` | Add item to dossier |
| PUT | `/dossiers/:id/items/:itemId` | Update item |
| DELETE | `/dossiers/:id/items/:itemId` | Delete item |
| POST | `/dossiers/:id/reorder` | Reorder items |

---

### Feedback (`/api/feedback/*`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/feedback` | Submit feedback (min 10 chars) |

```json
{
  "type": "bug",
  "message": "The PDF export fails when..."
}
```

---

### History (`/api/history/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/history` | List search history (supports `?limit=` `?offset=`) |
| POST | `/history` | Add search (deduplicates within 5 minutes) |
| DELETE | `/history/:id` | Delete single item |
| DELETE | `/history` | Clear all history |

---

### Health (`/api/health`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns status, timestamp, environment |

---

## Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant DB as Database

    C->>S: POST /auth/register
    S->>DB: Create user (isActive: false)
    S-->>C: 201 User created

    Note over C,S: Admin activates user

    C->>S: POST /auth/login
    S->>DB: Verify credentials
    S->>DB: Update loginCount, lastLoginAt
    S-->>C: 200 {access_token, refresh_token}

    C->>S: GET /api/bookmarks (Authorization: Bearer <access_token>)
    S->>S: Verify JWT
    S->>DB: Fetch user bookmarks
    S-->>C: 200 Bookmarks

    Note over C,S: Access token expires (30m)

    C->>S: POST /auth/refresh {refresh_token}
    S->>S: Verify refresh token
    S-->>C: 200 {new access_token, new refresh_token}
```

### Token Types

- **Access Token:** Short-lived (30m default), used for API requests
- **Refresh Token:** Long-lived (7d default), used to get new access tokens

### Password Security

- **Hashing:** bcryptjs with 10 salt rounds
- **Minimum length:** 3 characters (configurable)

---

## Error Handling

All errors return JSON:

```json
{
  "detail": "Error message"
}
```

**Status Codes:**

| Code | Description |
|------|-------------|
| `201` | Resource created |
| `204` | Deletion successful |
| `400` | Validation error, duplicate entry |
| `401` | Unauthorized (missing/invalid token) |
| `403` | Forbidden (admin required) |
| `404` | Resource not found |
| `500` | Internal server error |

---

## Security Features

### Admin Safeguards

- Cannot remove own admin privileges
- Cannot deactivate own account
- Cannot delete own account

### Data Protection

- All user data cascades on user deletion
- Folder deletion cascades to bookmarks
- Users can only access their own data

### Circular Reference Prevention

Folder move operations prevent a folder from being moved into its own descendant.

---

## Middleware Stack

1. **CORS** - Configurable allowed origins
2. **Body Parsing** - JSON and URL-encoded
3. **Express Async Errors** - Automatic promise rejection handling
4. **Authentication** - JWT verification for protected routes
5. **Admin Authorization** - Admin flag check for admin routes
6. **Error Handler** - Centralized error response formatting

---

## Project Structure

```
backend/
├── prisma/
│   └── schema.prisma      # Database schema
├── src/
│   ├── index.ts           # Entry point
│   ├── config.ts          # Configuration
│   ├── controllers/       # Business logic
│   ├── routes/            # Route definitions
│   ├── middleware/        # Auth, admin, error handling
│   └── utils/             # JWT, helpers
├── package.json
└── tsconfig.json
```

---

## Dependencies

**Runtime:**
- `@prisma/client` - Prisma ORM client
- `express` - Web framework
- `bcryptjs` - Password hashing
- `jsonwebtoken` - JWT tokens
- `cors` - CORS middleware
- `dotenv` - Environment variables
- `zod` - Schema validation
- `express-async-errors` - Async error handling

**Development:**
- `typescript` - TypeScript compiler
- `tsx` - TypeScript executor
- `prisma` - Prisma CLI
