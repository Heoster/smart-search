# 🔍 Tillu-Smart-Search — Service Plan v3.0
# Status: ✅ COMPLETE — Deployed on Vercel

> The internet eyes of TILLU. When Tillu needs real-time information — news, prices, weather, anything — this service goes out, finds it, and synthesizes it into a clean structured answer.

---

## Hosting

| Property | Value |
|---|---|
| **Platform** | Vercel (serverless functions) |
| **Status** | ✅ Deployed and working |
| **Base URL** | `https://tillu-search.vercel.app` |
| **Cost** | Free |

---

## Role in Ecosystem

Tillu-Smart-Search is called by Tillu-Flow whenever Tillu-Think determines the user's request needs **real-time web data**. It chains SearXNG (privacy-respecting meta-search) + optional web scraping + Groq LLM synthesis into one API call.

---

## Pipeline

```
Query
  │
  ▼
SearXNG (Google + Bing + DDG simultaneously)
  │ raw results
  ▼
Scraper (top 3 pages, full mode only)
  │ clean article text
  ▼
Groq llama-3.3-70b Synthesiser
  │ answer + key_points + facts
  ▼
Groq llama-3.3-70b Structurer
  │ normalized JSON schema
  ▼
Unified Response
```

---

## API Routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/unified` | **Primary.** Full pipeline. |
| `GET` | `/api/search` | Raw SearXNG results only. |
| `GET` | `/api/scraper` | Scrape a single URL. |
| `GET/POST` | `/api/synthesiser` | LLM synthesis over context. |
| `GET/POST` | `/api/llm-structurer` | Normalize data to schema. |

---

## Primary Endpoint

### `GET /api/unified?q=...&mode=fast`

| Param | Values | Default |
|---|---|---|
| `q` | search query | required |
| `mode` | `fast` · `full` · `search` | `fast` |
| `category` | `general` · `videos` · `news` · `images` | `general` |

Modes:
- `fast` — Search + AI synthesis. ~3–8s
- `full` — Search + scrape top 3 + AI synthesis. ~8–20s
- `search` — Raw results only, no AI. ~1–3s

Response includes: `synthesis.answer`, `structured.key_points`, `results.search`, `results.videos`, `meta.latency_ms`

---

## Terminology

| Term | Definition |
|---|---|
| **SearXNG** | Open-source privacy-respecting meta-search engine. Queries multiple engines simultaneously. |
| **Synthesis** | Groq LLM reads raw results and writes a coherent cited answer. |
| **Structuring** | Second LLM pass normalizing answer into consistent JSON schema. |
| **Mode: fast** | Search + AI. No scraping. Best for most queries. |
| **Mode: full** | Search + scrape + AI. Richer answers. Slower. |
| **Scraper** | Strips nav/ads/scripts from web pages. Returns clean article text. |
| **Structured Output** | Final normalized JSON: `answer`, `summary`, `key_points`, `sources`, `related_topics`, `facts`, `category`. |

---

## Integration Map

| Caller | Endpoint | When |
|---|---|---|
| Tillu-Flow | `GET /api/unified?mode=fast` | Real-time factual queries |
| Tillu-Flow | `GET /api/unified?mode=full` | Deep research queries |
| Tillu-Flow | `GET /api/unified?category=videos` | Video search |

---

## Technology Stack

| Component | Technology |
|---|---|
| Search Engine | SearXNG (self-hosted on HuggingFace Spaces) |
| LLM | Groq `llama-3.3-70b-versatile` |
| Scraping | Native fetch + HTML parsing |
| Runtime | Node.js on Vercel |

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | LLM synthesis and structuring |
| `SEARXNG_URL` | SearXNG instance URL |

---

## Files

```
tillu-smart-search/
├── api/
│   ├── unified.js        ← Full pipeline
│   ├── search.js         ← Raw SearXNG proxy
│   ├── scraper.js        ← Web page extractor
│   ├── synthesiser.js    ← Groq synthesis
│   └── llm-structurer.js ← Groq schema normalization
└── public/
    └── index.html        ← Test UI
```
