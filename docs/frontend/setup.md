# Frontend Setup

The frontend is a modern React 19 Single Page Application built with TypeScript and Vite. It provides a rich interface for searching, visualizing, and studying Italian legal texts.

**Development Server:** http://localhost:5173

---

## Requirements

- **Node.js 18+**
- **npm** or **yarn**

---

## Installation

```bash
cd frontend
npm install
```

---

## Environment Variables

Create a `.env` file in the frontend directory if needed:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:3001/api` | Node.js backend URL |

In most cases, the defaults work because Vite proxies API calls during development.

---

## Development

### Start Development Server

```bash
npm run dev
```

Opens at http://localhost:5173 with hot module replacement.

### Build for Production

```bash
npm run build
```

Creates optimized build in `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

---

## NPM Scripts

| Script | Description |
|--------|-------------|
| `dev` | Start Vite dev server with HMR |
| `build` | TypeScript check + production build |
| `lint` | Run ESLint |
| `preview` | Preview production build locally |
| `test` | Run Vitest tests |
| `test:ui` | Run tests with Vitest UI |
| `test:coverage` | Run tests with coverage report |

---

## Vite Proxy Configuration

During development, Vite proxies API calls to the appropriate backend:

| Route Pattern | Target | Description |
|---------------|--------|-------------|
| `/api/*` | `http://localhost:3001` | Node.js backend (auth, bookmarks, etc.) |
| `/fetch_*` | `http://localhost:5000` | Python API (legal data) |
| `/stream_article_text` | `http://localhost:5000` | Python API (streaming) |
| `/export_pdf` | `http://localhost:5000` | Python API (PDF export) |
| `/health` | `http://localhost:5000` | Python API (health check) |
| `/version` | `http://localhost:5000` | Python API (version info) |

See `vite.config.ts` for the complete proxy configuration.

---

## Project Structure

```
frontend/src/
├── App.tsx                    # Main app with routing
├── main.tsx                   # Entry point
│
├── components/
│   ├── ui/                    # Reusable UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── Input.tsx
│   │   ├── Toast.tsx
│   │   └── ...
│   │
│   ├── features/              # Feature-specific components
│   │   ├── search/            # Search form, results, article display
│   │   ├── workspace/         # Multi-tab workspace environment
│   │   │   └── StudyMode/     # Distraction-free study mode
│   │   ├── history/           # Search history
│   │   ├── dossier/           # Research collections
│   │   └── environments/      # Environment snapshots
│   │
│   ├── layout/                # Layout components
│   │   ├── Layout.tsx         # Main layout wrapper
│   │   └── Sidebar.tsx        # Navigation sidebar
│   │
│   └── auth/                  # Authentication components
│       ├── LoginForm.tsx
│       ├── RegisterForm.tsx
│       ├── ProtectedRoute.tsx
│       └── AdminRoute.tsx
│
├── hooks/                     # Custom React hooks
│   ├── useAuth.ts             # Authentication state
│   ├── useBookmarks.ts        # Bookmark management
│   ├── useHighlights.ts       # Text highlighting
│   ├── useAnnotations.ts      # Annotations
│   ├── useFolders.ts          # Folder management
│   └── useTour.ts             # Onboarding tour
│
├── services/                  # API services
│   ├── api.ts                 # Base Axios instance
│   ├── authService.ts         # Authentication
│   ├── bookmarkService.ts     # Bookmarks CRUD
│   ├── dossierService.ts      # Dossiers CRUD
│   ├── historyService.ts      # Search history
│   └── ...
│
├── store/
│   └── useAppStore.ts         # Zustand global store
│
├── types/
│   └── index.ts               # TypeScript type definitions
│
├── utils/                     # Utility functions
│   ├── dateUtils.ts
│   ├── citationParser.ts
│   ├── sanitize.tsx
│   └── ...
│
├── constants/                 # App constants
│   ├── actTypes.ts
│   ├── zIndex.ts
│   └── ...
│
├── config/                    # Configuration
│   └── tourConfig.ts          # Onboarding tour steps
│
└── pages/                     # Page components
    └── SearchPage.tsx
```

---

## Key Technologies

### Core

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 19.2.0 | UI framework |
| `react-dom` | 19.2.0 | DOM rendering |
| `react-router-dom` | 7.9.6 | Routing |
| `typescript` | 5.9.3 | Type safety |
| `vite` | 7.2.2 | Build tool |

### State Management

| Package | Purpose |
|---------|---------|
| `zustand` | Global state management |
| `immer` | Immutable state updates |

### UI & Styling

| Package | Purpose |
|---------|---------|
| `tailwindcss` | Utility-first CSS |
| `framer-motion` | Animations |
| `lucide-react` | Icons |
| `react-rnd` | Draggable/resizable elements |
| `@floating-ui/react` | Floating UI (tooltips, popovers) |
| `cmdk` | Command palette |
| `driver.js` | Onboarding tours |

### Utilities

| Package | Purpose |
|---------|---------|
| `axios` | HTTP client |
| `zod` | Schema validation |
| `date-fns` | Date formatting |
| `dompurify` | HTML sanitization |
| `jspdf` | PDF generation |
| `clsx` + `tailwind-merge` | Class name utilities |

### Drag & Drop

| Package | Purpose |
|---------|---------|
| `@dnd-kit/core` | Drag and drop core |
| `@dnd-kit/sortable` | Sortable lists |
| `@dnd-kit/utilities` | DnD utilities |

---

## Routing Structure

```
/ (ProtectedRoute)
├── Layout
│   ├── / (index)        → SearchPage
│   ├── /dossier         → DossierPage
│   ├── /history         → HistoryView
│   └── /environments    → EnvironmentPage

/login                   → LoginPage (public)
/register                → RegisterPage (public)
/admin/*                 → AdminPage (AdminRoute, lazy loaded)
```

---

## Global State (Zustand)

The store is located at `src/store/useAppStore.ts`.

### State Sections

```typescript
// Settings (persisted)
settings: AppSettings

// User Data (synced with backend)
bookmarks: Bookmark[]
dossiers: Dossier[]
annotations: Annotation[]
highlights: Highlight[]
quickNorms: QuickNorm[]
environments: Environment[]

// UI State
sidebarVisible: boolean
commandPaletteOpen: boolean
searchPanelState: { isCollapsed, position, zIndex }
workspaceTabs: WorkspaceTab[]
highestZIndex: number

// Search
searchTrigger: SearchParams | null
```

### Key Actions

```typescript
// UI
toggleSidebar()
openCommandPalette()
updateSettings(settings)

// Workspace
addWorkspaceTab(tab)
removeTab(tabId)
updateTab(tabId, updates)
bringTabToFront(tabId)

// Data
addBookmark(bookmark)
removeBookmark(id)
createDossier(dossier)
addHighlight(highlight)
triggerSearch(params)
```

---

## Theming

The app supports multiple themes:

| Theme | Description |
|-------|-------------|
| `light` | Light mode (default) |
| `dark` | Dark mode |
| `sepia` | Warm sepia tones |
| `high-contrast` | High contrast for accessibility |

Applied via:
- `.dark` class on `<html>` element
- `data-theme` attribute for sepia/high-contrast
- `data-font-size` for typography scaling

---

## Testing

```bash
# Run all tests
npm run test

# Run with interactive UI
npm run test:ui

# Run with coverage
npm run test:coverage
```

Uses **Vitest** with **@testing-library/react**.

---

## Linting

```bash
npm run lint
```

Uses ESLint with TypeScript and React hooks plugins.

---

## Troubleshooting

### CORS Errors

If you see CORS errors during development:
1. Ensure Python API is running on port 5000
2. Ensure Node.js backend is running on port 3001
3. Check Vite proxy configuration in `vite.config.ts`

### Build Errors

```bash
# Clear node_modules and reinstall
rm -rf node_modules
npm install

# Clear Vite cache
rm -rf node_modules/.vite
```

### TypeScript Errors

```bash
# Check types without building
npx tsc --noEmit
```
