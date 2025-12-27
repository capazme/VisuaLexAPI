# VisuaLex Web/API

> **Intelligent Legal Visualization and Research**

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-green)

VisuaLex is an advanced web application designed to research, visualize, and study legal texts from **Normattiva**, **EUR-Lex**, and **Brocardi**. It combines a powerful async Python backend with a rich React-based frontend to transform complex regulations into interactive knowledge graphs and structured views.

---

## Documentation

| Document | Description |
|----------|-------------|
| **[Architecture](docs/architecture.md)** | System overview, diagrams, data flow |
| **[Python API Setup](docs/backend/python_api_setup.md)** | Installation & configuration |
| **[Python API Reference](docs/backend/python_api_reference.md)** | All endpoints with payloads |
| **[Node.js Backend](docs/backend/node_backend.md)** | Platform services & Prisma schema |
| **[Frontend Setup](docs/frontend/setup.md)** | Installation & development |
| **[Component Library](docs/frontend/component_library.md)** | Reusable UI components |
| **[User Guide](docs/user_guide.md)** | End-user documentation |

---

## Quick Start

### Prerequisites

- **Python 3.10+**
- **Node.js 18+**
- **PostgreSQL** (for user data)

### Installation

```bash
# 1. Clone and setup Python API
cd VisuaLexAPI
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium  # Required for PDF export

# 2. Setup Node.js Backend
cd backend
npm install
cp .env.example .env        # Configure DATABASE_URL and JWT_SECRET
npm run prisma:generate
npm run prisma:migrate

# 3. Setup Frontend
cd ../frontend
npm install
```

### Running

```bash
# Option 1: Use start script (recommended)
./start.sh

# Option 2: Manual (3 terminals)
# Terminal 1: Python API
source .venv/bin/activate && python app.py      # :5000

# Terminal 2: Node.js Backend
cd backend && npm run dev                        # :3001

# Terminal 3: Frontend
cd frontend && npm run dev                       # :5173
```

**Access the application at:** http://localhost:5173

---

## Core Features

- **Multi-Source Search**: Unified interface for Italian Laws (Normattiva) and EU Regulations (EUR-Lex)
- **Study Mode**: Distraction-free reading environment with annotation tools
- **Brocardi Integration**: Automatic retrieval of legal maxims and explanatory notes
- **PDF Export**: Generate high-quality PDFs of regulations for offline use
- **Bookmarks & Dossiers**: Organize your research with folders and collections
- **Highlights & Annotations**: Mark up articles with colors and notes

---

## Project Structure

```
VisuaLexAPI/
├── app.py                    # Python API entry point (Quart)
├── visualex_api/             # Python API source
│   ├── services/             # Scrapers (Normattiva, EUR-Lex, Brocardi)
│   └── tools/                # Utilities (URN, parsing, config)
├── backend/                  # Node.js platform backend
│   ├── prisma/               # Database schema
│   └── src/                  # Express routes, controllers
├── frontend/                 # React SPA (Vite + TypeScript)
│   └── src/
│       ├── components/       # UI & feature components
│       ├── store/            # Zustand state management
│       └── services/         # API clients
├── docs/                     # Documentation
└── data/                     # Local data storage
```

---

## Troubleshooting

- **"Playwright: no such driver"**: Run `playwright install chromium`
- **PDF Export Fails**: Ensure Chromium is installed via Playwright
- **CORS Errors**: Check that all services are running on correct ports

---

## License

Internal/Educational Use. Please respect the Terms of Service of source data providers (Normattiva, EUR-Lex).
