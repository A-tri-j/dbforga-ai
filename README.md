# DBForge AI 🛠️⚡

**DBForge AI** is an intelligent, modern database engineering and management platform built for developers, DBAs, and data engineers. It combines high-performance multi-engine database exploration, an intelligent SQL workbench with AI-assisted authoring, interactive ER diagrams, schema comparison, query performance analysis, PDF table imports, and privacy-first local storage controls.

---

## 🌟 Key Features

### 1. 🗄️ Multi-Engine Database Support & Easy Connect
- Connect seamlessly to **PostgreSQL**, **MySQL / MariaDB**, **MongoDB**, and **MongoDB Atlas** (`mongodb+srv`).
- **Connection String Auto-Parser**: Paste connection strings from Neon, Supabase, Render, Atlas, or local environments; credentials, hosts, ports, and SSL modes are automatically detected and parsed.
- **Local Database Auto-Detection**: One-click detection scans common database ports (`5432`, `3306`, `27017`) on your local machine.
- **Safe & Encrypted**: All database passwords and API keys are encrypted at rest using Fernet symmetric encryption and never returned in API responses.

### 2. ⚡ Intelligent SQL & Mongo Workbench
- Embedded **Monaco Editor** with syntax highlighting, auto-completion, and dynamic theme switching (`vs` light / `vs-dark`).
- Tabbed results viewer with pagination, sorting, row metrics, and export to CSV/JSON.
- Multi-statement script execution, transaction management, and query cancellation.
- Automatic local browser script persistence per user.

### 3. 🕸️ Interactive ER Diagrams
- Dagre-powered layout engine with automatic refitting on window resize and panel expand.
- Visual line connections from source Foreign Key (FK) columns directly to target Primary Key (PK) columns.
- Relationship inference for unconstrained relations with distinct visual cues.
- Click a table to highlight all its inbound and outbound relationships.
- High-resolution PNG diagram export tailored to the active light/dark theme.

### 4. ⚖️ Schema Comparison & Snapshots
- Compare schemas between two live database connections or saved snapshots.
- Detailed diff view of missing tables, columns, data types, indexes, and constraints.
- Generate migration scripts to synchronize schema changes.

### 5. 🚀 Query Performance Analyzer
- Visual **EXPLAIN** / **EXPLAIN ANALYZE** execution plan tree.
- Automated bottleneck detection (e.g., sequential scans, high-cost nodes).
- AI-guided performance recommendations and missing index suggestions.

### 6. 🤖 Schema-Aware AI Assistant
- Chat interface powered by LLM providers (**OpenAI, Anthropic, Google Gemini, Groq, Ollama**).
- Schema-injected context enables accurate query generation, query optimization, and schema design advice.

### 7. 📄 PDF & Data Import
- Extract structured tables directly from PDF reports or documentation.
- Live preview, type mapping, error handling strategies, and direct import into your database.

### 8. 🌓 Seamless Light & Dark Themes
- Dynamic theme switching between **System**, **Light**, and **Dark** modes.
- Instant, anti-flash theme detection on initial page load.

### 9. 🔒 Sliding Session & "My Data" Management
- **Sliding 30-day authentication**: Active users stay logged in without sudden expirations.
- **My Data hub**: View storage usage, database row counts, inspect local file location, download a full non-sensitive JSON backup, and manage query history.

---

## 🏗️ Architecture & Tech Stack

```
dbforge-ai/
├── apps/
│   ├── backend/          # FastAPI Python backend
│   │   ├── app/          # Routers, services, domain models, adapters
│   │   └── tests/        # Pytest test suite (54+ automated tests)
│   └── frontend/         # Vite + React + TypeScript + Tailwind CSS
│       ├── src/          # Components, pages, hooks, state
│       └── ...
└── README.md
```

- **Backend**: Python 3.11+, [FastAPI](https://fastapi.tiangolo.com/), [SQLAlchemy](https://www.sqlalchemy.org/), [Pydantic v2](https://docs.pydantic.dev/), [PyMongo](https://pymongo.readthedocs.io/), [Cryptography (Fernet)](https://cryptography.io/), [Pytest](https://pytest.org/).
- **Frontend**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [@xyflow/react](https://reactflow.dev/), [Dagre](https://github.com/dagrejs/dagre), [Lucide React](https://lucide.dev/).

---

## 🚀 Quick Start Guide

### Prerequisites
- **Python**: 3.11 or higher
- **Node.js**: 18+ and **npm**

---

### 1. Backend Setup

1. Open a terminal and navigate to `apps/backend`:
   ```bash
   cd apps/backend
   ```

2. Create and activate a virtual environment:
   - **Windows (PowerShell)**:
     ```powershell
     python -m venv .venv
     .\.venv\Scripts\Activate.ps1
     ```
   - **Linux / macOS**:
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Configure your environment variables:
   ```bash
   cp .env.example .env
   ```
   Generate secure secrets or edit `.env`:
   ```env
   DBFORGE_JWT_SECRET=your-random-32-character-secret-key-here
   DBFORGE_ENCRYPTION_KEY=your-fernet-encryption-key-here
   DBFORGE_ALLOW_PRIVATE_HOSTS=true
   DBFORGE_DATABASE_URL=sqlite:///./dbforge.db
   DBFORGE_APP_MODE=web
   ```

5. Run database migrations / start the API server:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   The backend API will be available at `http://localhost:8000` (docs at `http://localhost:8000/docs`).

---

### 2. Frontend Setup

1. Open a new terminal and navigate to `apps/frontend`:
   ```bash
   cd apps/frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment configuration:
   ```bash
   cp .env.example .env
   ```
   Verify that `VITE_API_URL` points to `http://localhost:8000/api`.

4. Start the development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

---

## 🧪 Running Tests

### Backend Tests
From `apps/backend` (with the virtual environment activated):
```bash
pytest -v
```
*(All 54 tests covering auth, sessions, crypto, schema tools, and connections).*

### Frontend Tests
From `apps/frontend`:
```bash
npm test
```
To run production type-check and bundle build:
```bash
npm run build
```

---

## 🛡️ Security & Privacy
- **No plaintext credentials**: Database passwords and third-party AI keys are encrypted using Fernet cryptography.
- **Scoped Exports**: Data exports (`/api/account/export`) strip all sensitive secrets, credentials, and API tokens.
- **Private Network Protection**: Private/localhost target connections can be controlled via `DBFORGE_ALLOW_PRIVATE_HOSTS`.

---

## 📄 License
This project is licensed under the MIT License.
