"""
Worker Hub — Backend API
========================
Proxy seguro entre o frontend (GitHub Pages / Netlify) e os provedores de IA.

Tier "normal"  → Groq          (llama-3.3-70b-versatile)
Tier "deep"    → SambaNova     (Meta-Llama-3.3-405B-Instruct)
                   429 / erro  → fallback automático para Groq

Variáveis de ambiente necessárias:
  GROQ_API_KEY       — chave Groq
  SAMBANOVA_API_KEY  — chave SambaNova Cloud
  WORKER_TOKEN       — token secreto compartilhado com o frontend
  ALLOWED_ORIGIN     — origin exata do frontend (ex: https://myapp.netlify.app)
"""

import os
import logging
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

GROQ_API_KEY       = os.environ.get("GROQ_API_KEY", "")
SAMBANOVA_API_KEY  = os.environ.get("SAMBANOVA_API_KEY", "")
WORKER_TOKEN       = os.environ.get("WORKER_TOKEN", "")
ALLOWED_ORIGIN     = os.environ.get("ALLOWED_ORIGIN", "*")

GROQ_BASE_URL      = "https://api.groq.com/openai/v1"
SAMBANOVA_BASE_URL = "https://api.sambanova.ai/v1"

GROQ_MODEL         = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
SAMBANOVA_MODEL    = os.environ.get("SAMBANOVA_MODEL", "Meta-Llama-3.1-405B-Instruct")

# Timeout agressivo: SambaNova pode ser mais lento em inferência
REQUEST_TIMEOUT    = 60.0

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
log = logging.getLogger("worker")

def _masked(key: str) -> str:
    if not key:
        return "(empty)"
    if len(key) < 12:
        return f"***{key[-3:]} (len={len(key)})"
    return f"{key[:6]}...{key[-4:]} (len={len(key)})"

log.info("GROQ_API_KEY      = %s", _masked(GROQ_API_KEY))
log.info("SAMBANOVA_API_KEY = %s", _masked(SAMBANOVA_API_KEY))
log.info("WORKER_TOKEN      = %s", _masked(WORKER_TOKEN))
log.info("SAMBANOVA_MODEL   = %s", SAMBANOVA_MODEL)
log.info("GROQ_MODEL        = %s", GROQ_MODEL)


# ---------------------------------------------------------------------------
# HTTP client singleton
# ---------------------------------------------------------------------------
http_client: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
    log.info("HTTP client ready")
    yield
    await http_client.aclose()
    log.info("HTTP client closed")


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Worker Hub API",
    version="1.0.0",
    docs_url=None,   # desabilita Swagger em produção
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth — middleware manual (mais simples que Depends para header custom)
# ---------------------------------------------------------------------------
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # CORS preflight (OPTIONS) deve passar direto para o CORSMiddleware responder
    if request.method == "OPTIONS":
        return await call_next(request)

    # Health check é público
    if request.url.path == "/api/health":
        return await call_next(request)

    # Rotas protegidas: exigem X-Worker-Token
    if request.url.path.startswith("/api/"):
        token = request.headers.get("X-Worker-Token", "")
        if not WORKER_TOKEN:
            log.warning("WORKER_TOKEN não configurado — acesso bloqueado")
            return JSONResponse(
                {"error": "Backend não configurado"},
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE
            )
        if token != WORKER_TOKEN:
            return JSONResponse(
                {"error": "Não autorizado"},
                status_code=status.HTTP_401_UNAUTHORIZED
            )

    return await call_next(request)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    system: str = ""
    temp: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1, le=8192)
    tier: str = Field(default="normal", pattern="^(normal|deep)$")


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    count: int = Field(default=10, ge=1, le=50)


class SearchResult(BaseModel):
    id: int
    title: str
    snippet: str
    url: str
    source: str


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health():
    def _mask(key: str) -> str:
        if not key:
            return "(empty)"
        return key[:8] + "..." + key[-4:] + f" (len={len(key)})"

    return {
        "status": "ok",
        "groq": bool(GROQ_API_KEY),
        "sambanova": bool(SAMBANOVA_API_KEY),
        "token_set": bool(WORKER_TOKEN),
        "groq_model": GROQ_MODEL,
        "sambanova_model": SAMBANOVA_MODEL,
        "sambanova_key_preview": _mask(SAMBANOVA_API_KEY),
        "groq_key_preview": _mask(GROQ_API_KEY),
    }


# ---------------------------------------------------------------------------
# Helpers: chamar provedores
# ---------------------------------------------------------------------------
def _build_messages(request: ChatRequest) -> list[dict]:
    msgs = []
    if request.system:
        msgs.append({"role": "system", "content": request.system})
    msgs.extend({"role": m.role, "content": m.content} for m in request.messages)
    return msgs


async def _call_groq(request: ChatRequest) -> dict:
    """Chama a API Groq. Lança httpx.HTTPStatusError se der erro HTTP."""
    payload = {
        "model": GROQ_MODEL,
        "messages": _build_messages(request),
        "temperature": request.temp,
        "max_tokens": request.max_tokens,
    }
    resp = await http_client.post(
        f"{GROQ_BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        "content": data["choices"][0]["message"]["content"],
        "provider": "groq",
        "model": GROQ_MODEL,
        "fallback": False,
    }


async def _call_sambanova(request: ChatRequest) -> dict:
    """
    Chama a API SambaNova Cloud.
    Lança httpx.HTTPStatusError com status 429 em rate-limit.
    """
    payload = {
        "model": SAMBANOVA_MODEL,
        "messages": _build_messages(request),
        "temperature": request.temp,
        "max_tokens": request.max_tokens,
    }
    resp = await http_client.post(
        f"{SAMBANOVA_BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {SAMBANOVA_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        "content": data["choices"][0]["message"]["content"],
        "provider": "sambanova",
        "model": SAMBANOVA_MODEL,
        "fallback": False,
    }


# ---------------------------------------------------------------------------
# POST /api/chat
# ---------------------------------------------------------------------------
@app.post("/api/chat")
async def chat(request: ChatRequest):
    if request.tier == "deep":
        if not SAMBANOVA_API_KEY:
            log.warning("SAMBANOVA_API_KEY ausente — usando Groq como deep")
        else:
            try:
                result = await _call_sambanova(request)
                log.info("deep | SambaNova OK")
                return result
            except httpx.HTTPStatusError as e:
                body = e.response.text[:300]
                if e.response.status_code == 429:
                    log.warning("SambaNova 429 — fallback para Groq")
                elif e.response.status_code == 401:
                    log.error("SambaNova 401 UNAUTHORIZED — key prefix: %s, len: %d, body: %s",
                              SAMBANOVA_API_KEY[:8] if SAMBANOVA_API_KEY else '(empty)',
                              len(SAMBANOVA_API_KEY), body)
                else:
                    log.error("SambaNova erro %s: %s", e.response.status_code, body)
                # Qualquer erro SambaNova → fallback para Groq
            except httpx.TimeoutException:
                log.warning("SambaNova timeout — fallback para Groq")
            except Exception as exc:
                log.error("SambaNova inesperado: %s", exc)

        # Fallback: Groq, marca explicitamente
        if not GROQ_API_KEY:
            raise HTTPException(503, "Nenhum provedor disponível")
        try:
            result = await _call_groq(request)
            result["fallback"] = True
            log.info("deep | Groq fallback OK")
            return result
        except httpx.HTTPStatusError as e:
            body = e.response.text[:200]
            log.error("Groq fallback erro %s: %s", e.response.status_code, body)
            raise HTTPException(e.response.status_code, f"Groq error: {body}")

    else:  # tier == "normal"
        if not GROQ_API_KEY:
            raise HTTPException(503, "GROQ_API_KEY não configurado")
        try:
            result = await _call_groq(request)
            log.info("normal | Groq OK")
            return result
        except httpx.HTTPStatusError as e:
            body = e.response.text[:200]
            log.error("Groq normal erro %s: %s", e.response.status_code, body)
            raise HTTPException(e.response.status_code, f"Groq error: {body}")
        except httpx.TimeoutException:
            raise HTTPException(504, "Groq timeout")


# ---------------------------------------------------------------------------
# POST /api/search
# (Proxia DuckDuckGo HTML — evita CORS no browser e substitui allorigins.win)
# ---------------------------------------------------------------------------
@app.post("/api/search")
async def search(request: SearchRequest):
    import re as _re
    from html.parser import HTMLParser

    class DDGParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self._in_title = False
            self._in_snippet = False
            self._in_url = False
            self._current: dict = {}
            self.items: list[dict] = []
            # hidden form fields for pagination
            self.next_params: dict = {}

        def handle_starttag(self, tag, attrs):
            attrs_d = dict(attrs)
            cls = attrs_d.get("class", "")
            if "result__title" in cls:
                self._in_title = True; self._current = {}
            elif "result__snippet" in cls:
                self._in_snippet = True
            elif "result__url" in cls:
                self._in_url = True
            # capture hidden form fields for page 2
            if tag == "input" and attrs_d.get("type") == "hidden":
                name = attrs_d.get("name", "")
                value = attrs_d.get("value", "")
                if name in ("s", "nextParams", "vqd", "v", "o", "dc", "api", "kl"):
                    self.next_params[name] = value

        def handle_endtag(self, tag):
            if self._in_title and tag in ("h2", "a"):
                self._in_title = False
            if self._in_snippet and tag == "a":
                self._in_snippet = False
                if self._current.get("title") and self._current.get("snippet"):
                    self.items.append(dict(self._current))
            if self._in_url and tag == "a":
                self._in_url = False

        def handle_data(self, data):
            data = data.strip()
            if not data:
                return
            if self._in_title:
                self._current["title"] = data
            elif self._in_snippet:
                self._current.setdefault("snippet", "")
                self._current["snippet"] += data
            elif self._in_url:
                self._current["url"] = "https://" + data.strip()
                self._current["source"] = data.strip().split("/")[0]

    def _parse_ddg_items(parser: DDGParser, existing_urls: set, limit: int, id_offset: int) -> list[dict]:
        out = []
        for item in parser.items:
            if len(out) + id_offset >= limit:
                break
            url = item.get("url", "#")
            if url in existing_urls:
                continue
            existing_urls.add(url)
            out.append({
                "id": id_offset + len(out),
                "title": item.get("title", ""),
                "snippet": item.get("snippet", ""),
                "url": url,
                "source": item.get("source", "unknown"),
            })
        return out

    results: list[dict] = []
    seen_urls: set = set()
    need = request.count + 5  # fetch extra so frontend has room to filter

    # 1. DuckDuckGo page 1
    page1_parser = DDGParser()
    try:
        ddg_url = "https://html.duckduckgo.com/html/?" + str(httpx.URL("", params={"q": request.query}).params)
        resp = await http_client.get(
            ddg_url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; WorkerHub/1.0)"},
            follow_redirects=True,
        )
        page1_parser.feed(resp.text)
        results.extend(_parse_ddg_items(page1_parser, seen_urls, need, 0))
        log.info("DDG page 1: %d results", len(results))
    except Exception as exc:
        log.warning("DuckDuckGo página 1 falhou: %s", exc)

    # 2. DuckDuckGo page 2 (if we still need more)
    if len(results) < need and page1_parser.next_params.get("vqd"):
        try:
            form = {"q": request.query, **page1_parser.next_params}
            resp2 = await http_client.post(
                "https://html.duckduckgo.com/html/",
                data=form,
                headers={"User-Agent": "Mozilla/5.0 (compatible; WorkerHub/1.0)"},
                follow_redirects=True,
            )
            page2_parser = DDGParser()
            page2_parser.feed(resp2.text)
            results.extend(_parse_ddg_items(page2_parser, seen_urls, need, len(results)))
            log.info("DDG page 2: %d total results", len(results))
        except Exception as exc:
            log.warning("DuckDuckGo página 2 falhou: %s", exc)

    # 3. Wikipedia EN — supplement when DDG < requested count
    if len(results) < request.count:
        wiki_need = min(request.count - len(results), 20)
        try:
            resp_wiki = await http_client.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query", "list": "search",
                    "srsearch": request.query,
                    "srlimit": wiki_need, "format": "json",
                },
                headers={"User-Agent": "WorkerHub/1.0 (https://github.com/armandoerthalcarvalho/worker-hub)"},
            )
            data = resp_wiki.json()
            for x in data["query"]["search"]:
                if len(results) >= request.count:
                    break
                url = f"https://en.wikipedia.org/wiki/{x['title'].replace(' ', '_')}"
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                snippet = _re.sub(r"<[^>]+>", "", x["snippet"])
                results.append({
                    "id": len(results),
                    "title": x["title"],
                    "snippet": snippet,
                    "url": url,
                    "source": "wikipedia.org",
                })
            log.info("Wikipedia aportou %d resultados extras", len(results))
        except Exception as exc:
            log.warning("Wikipedia EN falhou: %s", exc)

    return {"results": results[: request.count]}
