<p align="center">
  <img src="https://img.shields.io/badge/Worker_Hub-Intelligent_Research-f5a623?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmNWE2MjMiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0iTTEyIDJMMiA3bDEwIDUgMTAtNS0xMC01eiIvPjxwYXRoIGQ9Ik0yIDE3bDEwIDUgMTAtNSIvPjxwYXRoIGQ9Ik0yIDEybDEwIDUgMTAtNSIvPjwvc3ZnPg==" alt="Worker Hub"/>
</p>

<h1 align="center">🛠️ Worker Hub</h1>

<p align="center">
  <strong>AI-powered research, chat, and productivity — zero setup, 100% browser-based.</strong>
</p>

<p align="center">
  <a href="https://armandoerthalcarvalho.github.io/worker-hub/"><img src="https://img.shields.io/badge/🚀_Live_Demo-Open_App-f5a623?style=flat-square" alt="Live Demo"/></a>
  <img src="https://img.shields.io/github/license/armandoerthalcarvalho/worker-hub?style=flat-square&color=4afa8a" alt="License"/>
  <img src="https://img.shields.io/badge/frontend-vanilla_JS-f5a623?style=flat-square" alt="Frontend"/>
  <img src="https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square" alt="Backend"/>
  <img src="https://img.shields.io/badge/AI-Groq_%7C_SambaNova-b57aff?style=flat-square" alt="AI Providers"/>
</p>

---

## What is Worker Hub?

Worker Hub is an all-in-one AI workspace that combines **intelligent web search**, **multi-tool chat**, and **productivity features** in a single app. It runs entirely in your browser — no accounts, no installs, no configuration.

Search any topic → AI ranks, scores, and enriches the results. Switch to chat with 12+ specialized AI tools. Plan meetings, manage tasks, generate emails, and review documents — all powered by LLMs.

---

## Features

### 🔍 Research Hub

| Feature | Description |
|---------|-------------|
| **AI-Ranked Search** | Search the web, AI scores results 0–100 and explains relevance |
| **Deep Mode** | Uses SambaNova DeepSeek V3 for advanced analysis |
| **Enrich** | Expand any result with AI-generated context and key points |
| **Summarize** | One-click executive summary (150 words) |
| **Compare** | Side-by-side analysis of 2+ selected results |
| **Timeline** | Generate a chronological timeline from any topic |
| **Overall Analysis** | AI synthesizes all results into collective insights |
| **Export** | Download research as `.md` |

Results come from DuckDuckGo (with pagination for 20+ results) and Wikipedia fallback.

### 💬 AI Chat — 12 Built-in Tools

Every tool has a specialized system prompt, color, and context hints. Tools marked with ⚡ use the **deep tier** (SambaNova DeepSeek V3).

| Tool | Tier | Purpose |
|------|------|---------|
| 💬 Free Chat | Normal | General conversation |
| ⚡ Code Expert | Deep | Debug, refactor, code review |
| 🌐 Translator Pro | Normal | 40+ languages with cultural nuance |
| 🔬 Deep Research | Deep | Academic-grade analysis |
| ✍️ Writer Pro | Normal | Creative content and copywriting |
| 📊 Data Analyst | Deep | Data patterns and visualization |
| 🎯 Prompt Engineer | Deep | Optimize LLM prompts |
| 🗄️ SQL Master | Deep | Queries, optimization, schema design |
| 🔒 Sec Analyst | Deep | Security analysis and hardening |
| ∑ Math Solver | Deep | Step-by-step equations and proofs |
| 🌊 Brainstormer | Normal | Design Thinking, lateral ideas |
| 📈 SEO & Copy | Normal | Marketing content and strategies |

**Custom Tools** — Create your own tools with custom system prompts. All custom tools use the deep tier.

**Chat features:** 20-message context window, voice input, canvas side-panel, provider badges, auto-fallback notifications, export to Markdown.

### 📅 Productivity Suite

| Module | Description |
|--------|-------------|
| **📅 Calendar** | Month/week views, color-coded events, smart notifications (7d/3d/1d/today) |
| **✅ Tasks** | Priority levels, subtasks, due dates, **AI task decomposition** from a single goal |
| **📧 Email Master** | Write, reply, or improve emails with tone selection (formal, casual, technical) |
| **🤝 Meeting Planner** | Generate agendas, minutes, follow-ups, or invites — save directly to calendar |
| **📄 Doc Reviewer** | Paste or drag-drop a document → AI scores it 0–100 with issues and recommendations. Supports general, legal, technical, contract, report, and academic review types |

---

## Architecture

```
┌──────────────────────┐        ┌──────────────────────────────┐
│   GitHub Pages       │        │   Railway (Python)            │
│                      │  HTTPS │                              │
│  index.html          ├───────►│  FastAPI backend              │
│  styles.css          │        │                              │
│  app.js              │        │  /api/chat ──► Groq / SambaNova
│                      │◄───────┤  /api/search ──► DuckDuckGo  │
│  localStorage        │        │  /api/health                 │
└──────────────────────┘        └──────────────────────────────┘
```

**Tier routing:**
- **Normal** → Groq `llama-3.3-70b-versatile` (fast, 70B)
- **Deep** → SambaNova `DeepSeek-V3-0324` (powerful, auto-fallback to Groq on error)

API keys **never** leave the backend. The frontend only holds a bridge token.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla JS, HTML5, CSS3 (no frameworks) |
| **Backend** | Python 3.11, FastAPI 0.115, Uvicorn, httpx |
| **AI Providers** | Groq (Llama 3.3 70B), SambaNova (DeepSeek V3) |
| **Search** | DuckDuckGo HTML proxy, Wikipedia EN API |
| **Hosting** | GitHub Pages (frontend), Railway (backend) |
| **Fonts** | JetBrains Mono, Syne, Space Grotesk |
| **Storage** | localStorage (no database needed) |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command palette |
| `Enter` | Send chat message |
| `Shift+Enter` | New line in chat |
| `Ctrl+Enter` | Run search |
| `/` | Focus input |
| `Esc` | Close overlays |

---

## Self-Hosting

Want to run your own instance? You'll need API keys from Groq and SambaNova (both free tier available).

### 1. Clone

```bash
git clone https://github.com/armandoerthalcarvalho/worker-hub.git
cd worker-hub
```

### 2. Backend Setup

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your keys:

```env
GROQ_API_KEY=gsk_your_key_here
SAMBANOVA_API_KEY=your_sambanova_key_here
WORKER_TOKEN=any-random-secret-string
ALLOWED_ORIGIN=*
```

Get free API keys:
- **Groq**: [console.groq.com](https://console.groq.com)
- **SambaNova**: [cloud.sambanova.ai](https://cloud.sambanova.ai)

### 3. Run Locally

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

Then open `index.html` in your browser (or serve via any static server).

### 4. Deploy to Railway (optional)

The `backend/railway.toml` is pre-configured. Set your environment variables in the Railway dashboard and deploy.

---

## Project Structure

```
worker-hub/
├── index.html              # UI layout and components
├── styles.css              # Dark/light theme design system
├── app.js                  # Frontend logic (1700+ lines)
├── .gitignore
├── README.md
└── backend/
    ├── main.py             # FastAPI server, AI proxy, search
    ├── requirements.txt    # Python dependencies
    ├── railway.toml        # Railway deployment config
    └── .env.example        # Environment variable template
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Groq API key for Llama 3.3 70B |
| `SAMBANOVA_API_KEY` | Yes | SambaNova API key for DeepSeek V3 |
| `WORKER_TOKEN` | Yes | Shared bridge token (frontend ↔ backend) |
| `ALLOWED_ORIGIN` | No | CORS origin (default: `*`) |
| `GROQ_MODEL` | No | Override Groq model (default: `llama-3.3-70b-versatile`) |
| `SAMBANOVA_MODEL` | No | Override SambaNova model (default: `DeepSeek-V3-0324`) |

---

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/health` | GET | Public | Server status, provider availability, model info |
| `/api/chat` | POST | Token | Chat completion with tier routing and auto-fallback |
| `/api/search` | POST | Token | Web search proxy (DuckDuckGo + Wikipedia) |

---

## License

MIT

---

<p align="center">
  Built with ☕ and AI by <a href="https://github.com/armandoerthalcarvalho">Armando Erthal Carvalho</a>
</p>
