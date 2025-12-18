# VisuaLex Web/API

> **Intelligent Legal Visualization and Research**

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-green)

VisuaLex is an advanced web application designed to research, visualize, and study legal texts from **Normattiva**, **EUR-Lex**, and **Brocardi**. It combines a powerful async Python backend with a rich React-based frontend to transform complex regulations into interactive knowledge graphs and structured views.

### 📚 Documentation
- **[User Guide](docs/user_guide.md)**: specialized instructions on how to use the Workspace and Study Mode.
- **[Architecture](docs/architecture.md)**: Technical deep-dive into the Quart backend and React frontend.

---

## Quick Start

### Prerequisites
- **Python 3.10+**
- **Node.js 18+** (for frontend development)
- **Google Chrome** (for PDF export)
- **ChromeDriver** (matching your Chrome version)

### Installation

1. **Clone and Setup Backend**
   ```bash
   cd VisuaLexAPI
   python -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Frontend Setup (Optional/Dev)**
   If you need to build the frontend:
   ```bash
   cd frontend
   npm install
   npm run build
   ```

### Running the App
```bash
# From root directory
source .venv/bin/activate
python app.py
```
- **Web Interface**: [http://localhost:5000](http://localhost:5000)
- **API Docs**: Available at root endpoints (e.g., `/fetch_article_text`).

---

## Core Features

- **Multi-Source Search**: Unified interface for Italian Laws (Normattiva) and EU Regulations (EUR-Lex).
- **Study Mode**: Distraction-free reading environment with annotation tools.
- **Brocardi Integration**: Automatic retrieval of legal maxims and explanatory notes.
- **PDF Export**: Generate high-quality PDFs of regulations for offline use.
- **Knowledge Graph**: (Beta) Visualize connections between laws.

## Project Structure

```text
VisuaLexAPI/
├── app.py                 # Backend Entry Point (Quart)
├── visualex_api/          # Backend Source Code
│   ├── services/          # Scrapers & Logic
│   └── tools/             # Utilities
├── frontend/              # Frontend Source Code (React/Vite)
│   ├── src/
│   │   ├── components/    # Reusable UI & Features
│   │   └── services/      # API Integration
│   └── public/            # Static Assets (Favicon, Manifest)
├── docs/                  # Documentation
└── data/                  # Local data storage
```

## API Endpoints Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Serves the main web application |
| `POST` | `/fetch_norma_data` | Retreives structure metadata for a law |
| `POST` | `/fetch_article_text` | Retreives full text of specific articles |
| `POST` | `/export_pdf` | Generates a PDF of the current view |

See `app.py` or the Architecture docs for detailed payload specs.

## Troubleshooting

- **"Selenium: no such driver"**: Ensure `chromedriver` is in your PATH.
- **PDF Export Fails**: Check if Chrome is installed and accessible in headless mode.

## License
Internal/Educational Use. Please respect the Terms of Service of source data providers (Normattiva, EUR-Lex).
