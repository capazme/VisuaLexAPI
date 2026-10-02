# VisuaLex Web/API

> **Intelligent Legal Visualization and Research**

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Python](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
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
| **[Setup](docs/setup.md)** | From clone to a running stack and green suites |
| **[Git workflow](docs/git-workflow.md)** | `develop` and `main`, pull requests, code owners, releases, hotfixes |

---

## Quick Start

```bash
git clone --recurse-submodules https://github.com/capazme/VisuaLexAPI.git
cd VisuaLexAPI && git switch develop
./start.sh
```

The one-time setup (Docker, Node, Python, the `.env` files) is in
[docs/setup.md](docs/setup.md).

## Core Features

- **Multi-Source Search**: Unified interface for Italian Laws (Normattiva) and EU Regulations (EUR-Lex)
- **Study Mode**: Distraction-free reading environment with annotation tools
- **Brocardi Integration**: Automatic retrieval of legal maxims and explanatory notes
- **PDF Export**: Generate high-quality PDFs of regulations for offline use
- **Bookmarks & Dossiers**: Organize your research with folders and collections
- **Highlights & Annotations**: Mark up articles with colors and notes

---

## Project Structure

| Path | What |
|---|---|
| `apps/web/` | React + Vite web app |
| `apps/server/` | Express + Prisma: accounts, dossiers, community |
| `services/visualex/` | Python API (Quart): Normattiva, EUR-Lex, Brocardi |
| `services/merlt/` | MERL-T knowledge graph and RLCF (Apache-2.0) |
| `tools/` | archive CLI, end-to-end harness |
| `infra/` | Docker Compose stack |
| `scripts/` | data backup and restore |
| `docs/` | documentation — start from [docs/README.md](docs/README.md) |

## Releases

There is no public deployment at the moment. Releases are tags on `main`;
day-to-day work goes to `develop` — see [docs/git-workflow.md](docs/git-workflow.md).

## Troubleshooting

- **"Playwright: no such driver"**: Run `services/visualex/.venv/bin/playwright install chromium`
- **PDF Export Fails**: Ensure Chromium is installed via Playwright
- **CORS Errors**: Check that all services are running on correct ports

---

## License

MIT — see [LICENSE](LICENSE).

The licence covers this software only. The legal texts it retrieves come from
third parties: please respect the Terms of Service of Normattiva, EUR-Lex,
Brocardi and the Corte di cassazione's SentenzeWeb; the Corte costituzionale's
open data are licensed CC BY-SA 3.0 and are credited wherever they appear.

Portions of the act-resolution tables and the Akoma Ntoso parser derive from
[mcp-legal-it](https://github.com/capazme/mcp-legal-it), by the same author,
relicensed MIT by the copyright holder, and so does the Corte costituzionale
open-data reader.
