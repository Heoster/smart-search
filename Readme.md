# Tillu Smart Search — API Documentation

AI-powered search engine combining **SearXNG** + **Groq LLM** (llama-3.3-70b) + **smart web scraping**.  
All endpoints are CORS-enabled and return JSON.

**Base URL:** `https://YOUR_SEARXNG_URL.XYZ`

---

## Table of Contents

- [Quick Start](#quick-start)
- [Endpoints](#endpoints)
  - [GET /api/unified](#get-apiunified) — full pipeline (recommended)
  - [GET /api/search](#get-apisearch) — raw search results
  - [GET /api/scraper](#get-apiscraper) — web page scraper
  - [GET /api/synthesiser](#get-apisynthesiser) — LLM synthesis
  - [GET /api/llm-structurer](#get-apillm-structurer) — LLM data structurer
- [Error Responses](#error-responses)
- [Environment Variables](#environment-variables)
- [Timeouts](#timeouts)

---

## Quick Start

```bash
# Simplest possible call — fast AI-powered search
curl "https://your-deployment.vercel.app/api/unified?q=what+is+rust+programming"

# Video search
curl "https://your-deployment.vercel.app/api/unified?q=react+tutorial&category=videos"

# Deep search with page scraping
curl "https://your-deployment.vercel.app/api/unified?q=bitcoin+price&mode=full"
```

---

## Endpoints

---

### GET /api/unified

The main endpoint. Runs the full pipeline: **search → scrape → synthesize → structure**.  
Use this for everything unless you need a specific step in isolation.

#### Parameters

| Parameter  | Type   | Required | Default   | Description |
|------------|--------|----------|-----------|-------------|
| `q`        | string | ✅ yes   | —         | Search query |
| `category` | string | no       | `general` | `general` · `videos` · `news` · `images` |
| `mode`     | string | no       | `fast`    | `fast` · `full` · `search` (see below) |

#### Modes

| Mode     | What it does |
|----------|-------------|
| `fast`   | Search + AI synthesis + AI structuring. No page scraping. ~3–8s |
| `full`   | Search + scrape top 3 pages + AI synthesis + AI structuring. Richer answers. ~8–20s |
| `search` | Search only. Returns raw results, no AI. ~1–3s |

#### Example Request

```bash
curl "https://your-deployment.vercel.app/api/unified?q=python+tutorial&mode=fast"
```

#### Example Response (`mode=fast`)

```json
{
  "success": true,
  "query": "python tutorial",
  "category": "general",
  "mode": "fast",
  "results": {
    "search": [
      {
        "title": "Python Tutorial — W3Schools",
        "url": "https://www.w3schools.com/python/",
        "snippet": "Well organized and easy to understand...",
        "engine": "google",
        "category": "general",
        "thumbnail": "",
        "publishedDate": null,
        "score": 1
      }
    ],
    "videos": [
      {
        "title": "Python Tutorial for Beginners",
        "url": "https://www.youtube.com/watch?v=...",
        "thumbnail": "https://i.ytimg.com/vi/.../hqdefault.jpg",
        "snippet": "Full Python course for beginners",
        "engine": "youtube",
        "publishedDate": null
      }
    ],
    "scraped": []
  },
  "synthesis": {
    "answer": "Python is a high-level, interpreted programming language...",
    "key_points": [
      "Python uses indentation for code blocks",
      "Supports multiple paradigms: OOP, functional, procedural",
      "Huge standard library and ecosystem"
    ],
    "facts": [
      "Python was created by Guido van Rossum in 1991",
      "Python 3 is the current major version"
    ]
  },
  "structured": {
    "answer": "Python is a versatile, beginner-friendly language...",
    "summary": "Python is widely used in web development, data science, AI...",
    "key_points": ["Easy syntax", "Large community", "Versatile"],
    "sources": [
      { "title": "Python Tutorial — W3Schools", "url": "https://...", "snippet": "..." }
    ],
    "related_topics": ["Django", "NumPy", "Machine Learning"],
    "facts": ["Created in 1991", "Ranked #1 on TIOBE index"],
    "category": "programming"
  },
  "meta": {
    "engines_used": ["google", "bing", "duckduckgo"],
    "total_results": 10,
    "scraped_pages": 0,
    "latency_ms": 4231
  }
}
```

#### Response Fields

| Field               | Description |
|---------------------|-------------|
| `results.search`    | Up to 10 web results |
| `results.videos`    | Up to 8 video results (auto-detected from YouTube, Vimeo, etc.) |
| `results.scraped`   | Pages scraped in `full` mode (title, url, contentLength) |
| `synthesis`         | Raw Groq answer with `answer`, `key_points`, `facts` |
| `structured`        | Groq-structured output with richer schema (see below) |
| `meta.latency_ms`   | Total pipeline time in milliseconds |

#### `structured` object schema

```json
{
  "answer": "1–3 sentence direct answer",
  "summary": "2–4 sentence summary",
  "key_points": ["...", "..."],
  "sources": [{ "title": "...", "url": "...", "snippet": "..." }],
  "videos": [{ "title": "...", "url": "...", "thumbnail": "..." }],
  "related_topics": ["...", "..."],
  "facts": ["...", "..."],
  "category": "programming"
}
```

> `structured` can be `null` if Groq synthesis failed. Always fall back to `synthesis` in that case.

---

### GET /api/search

Raw SearXNG search proxy. Returns results without any AI processing.

#### Parameters

| Parameter  | Type    | Required | Default   | Description |
|------------|---------|----------|-----------|-------------|
| `q`        | string  | ✅ yes   | —         | Search query |
| `category` | string  | no       | `general` | `general` · `videos` · `news` · `images` |
| `pageno`   | integer | no       | `1`       | Page number (must be ≥ 1) |

#### Example Request

```bash
curl "https://your-deployment.vercel.app/api/search?q=javascript+frameworks&category=general"
```

#### Example Response

```json
{
  "success": true,
  "query": "javascript frameworks",
  "category": "general",
  "pageno": 1,
  "total": 10,
  "engines": ["google", "bing"],
  "results": [
    {
      "title": "Top JavaScript Frameworks in 2024",
      "url": "https://example.com/js-frameworks",
      "snippet": "React, Vue, Angular are the most popular...",
      "engine": "google",
      "category": "general",
      "thumbnail": "",
      "publishedDate": "2024-01-15",
      "score": 0.9
    }
  ]
}
```

---

### GET /api/scraper

Scrapes a web page and returns clean extracted text, title, description, and links.  
Strips scripts, styles, nav, header, footer, and sidebar. Prefers `<article>` → `<main>` → `<body>` content.

#### Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `url`     | string | ✅ yes   | Full URL to scrape. Must be `http://` or `https://` |

#### Example Request

```bash
curl "https://your-deployment.vercel.app/api/scraper?url=https://en.wikipedia.org/wiki/Python_(programming_language)"
```

#### Example Response

```json
{
  "success": true,
  "url": "https://en.wikipedia.org/wiki/Python_(programming_language)",
  "title": "Python (programming language) - Wikipedia",
  "description": "Python is a high-level, general-purpose programming language.",
  "content": "Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability...",
  "contentLength": 42381,
  "truncated": true,
  "links": [
    { "text": "Guido van Rossum", "url": "https://en.wikipedia.org/wiki/Guido_van_Rossum" },
    { "text": "CPython", "url": "https://en.wikipedia.org/wiki/CPython" }
  ]
}
```

#### Notes

- `content` is capped at **5,000 characters**, truncated at a word boundary
- `truncated: true` means the original page had more content than the limit
- `links` returns up to **15** external links found on the page
- Timeout: **8 seconds** — slow or bot-blocking sites return a 502

---

### GET /api/synthesiser

Takes a query + context (search results or scraped content) and uses Groq LLM to synthesize a comprehensive answer.  
Accepts both **GET** and **POST**.

#### Parameters — GET

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `q`       | string | ✅ yes   | The question to answer |
| `context` | string | no       | URL-encoded JSON array of context objects (see below) |

#### Parameters — POST (recommended for large context)

Send a JSON body:

```json
{
  "q": "what is rust programming",
  "context": [
    {
      "title": "Rust Programming Language",
      "snippet": "Rust is a systems programming language focused on safety...",
      "url": "https://www.rust-lang.org",
      "content": "Optional longer scraped content..."
    }
  ]
}
```

#### Context object fields

| Field     | Description |
|-----------|-------------|
| `title`   | Source title |
| `snippet` | Short excerpt (up to 300 chars used) |
| `url`     | Source URL |
| `content` | Longer scraped content (up to 800 chars used) |

#### Example Request — GET

```bash
curl "https://your-deployment.vercel.app/api/synthesiser?q=what+is+rust&context=[{\"title\":\"Rust\",\"snippet\":\"Rust is memory safe without GC\"}]"
```

#### Example Request — POST

```bash
curl -X POST "https://your-deployment.vercel.app/api/synthesiser" \
  -H "Content-Type: application/json" \
  -d '{
    "q": "what is rust programming",
    "context": [
      { "title": "Rust Lang", "snippet": "Rust is a systems language focused on safety, speed, and concurrency." },
      { "title": "Why Rust", "snippet": "Rust has zero-cost abstractions and no garbage collector." }
    ]
  }'
```

#### Example Response

```json
{
  "success": true,
  "query": "what is rust programming",
  "synthesis": {
    "answer": "Rust is a systems programming language that prioritizes memory safety and performance without a garbage collector. It achieves memory safety through its ownership model...",
    "key_points": [
      "Memory safe without a garbage collector",
      "Zero-cost abstractions",
      "Ownership and borrowing system prevents data races",
      "Compiles to native code — comparable speed to C/C++"
    ],
    "facts": [
      "Rust was created at Mozilla Research",
      "First stable release was in 2015"
    ]
  },
  "model": "llama-3.3-70b-versatile"
}
```

---

### GET /api/llm-structurer

Takes a query + raw data (any JSON) and uses Groq LLM to restructure it into a clean, consistent schema.  
Useful for normalizing data from multiple sources into a single format.  
Accepts both **GET** and **POST**.

#### Parameters — GET

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `q`       | string | ✅ yes   | The search query the data relates to |
| `data`    | string | no       | URL-encoded JSON object of raw data to structure |

#### Parameters — POST (recommended)

```json
{
  "q": "python programming",
  "data": {
    "results": [
      { "title": "Python.org", "snippet": "Python is a programming language", "url": "https://python.org" }
    ]
  }
}
```

#### Example Request — GET

```bash
curl "https://your-deployment.vercel.app/api/llm-structurer?q=python&data={\"results\":[{\"title\":\"Python\",\"snippet\":\"A programming language\",\"url\":\"https://python.org\"}]}"
```

#### Example Request — POST

```bash
curl -X POST "https://your-deployment.vercel.app/api/llm-structurer" \
  -H "Content-Type: application/json" \
  -d '{
    "q": "climate change",
    "data": {
      "results": [
        { "title": "NASA Climate", "snippet": "Global temperatures have risen 1.1°C since pre-industrial times", "url": "https://climate.nasa.gov" }
      ]
    }
  }'
```

#### Example Response

```json
{
  "success": true,
  "query": "climate change",
  "structured": {
    "answer": "Climate change refers to long-term shifts in global temperatures and weather patterns...",
    "summary": "Since the industrial revolution, human activities have been the main driver of climate change...",
    "key_points": [
      "Global temperatures have risen 1.1°C since pre-industrial times",
      "CO2 levels are at their highest in 800,000 years",
      "Sea levels are rising at 3.3mm per year"
    ],
    "sources": [
      { "title": "NASA Climate", "url": "https://climate.nasa.gov", "snippet": "Global temperatures have risen..." }
    ],
    "related_topics": ["greenhouse gases", "Paris Agreement", "renewable energy"],
    "facts": ["1.1°C rise since pre-industrial times"],
    "category": "science"
  },
  "model": "llama-3.3-70b-versatile"
}
```

---

## Error Responses

All endpoints return a consistent error shape:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "query": "the original query"
}
```

| HTTP Status | Meaning |
|-------------|---------|
| `400`       | Bad request — missing or invalid parameter |
| `500`       | Server misconfiguration (e.g. invalid `SEARXNG_URL`) |
| `502`       | Upstream failure — SearXNG timeout, Groq error, or scrape failure |

---

## Environment Variables

| Variable      | Required | Default | Description |
|---------------|----------|---------|-------------|
| `GROQ_API_KEY` | ✅ yes  | —       | Groq API key from [console.groq.com](https://console.groq.com/keys). Without it, AI synthesis is disabled and raw results are returned. |
| `SEARXNG_URL`  | no      | `https://tillu-searxng.onrender.com` | SearXNG instance base URL |

Set these in **Vercel Dashboard → Project → Settings → Environment Variables**.

---

## Timeouts

| Endpoint         | Timeout  | Max Duration (Vercel) |
|------------------|----------|-----------------------|
| `/api/unified`   | 12s search + 20s Groq × 2 | 60s |
| `/api/synthesiser` | 20s Groq | 30s |
| `/api/llm-structurer` | 20s Groq | 30s |
| `/api/scraper`   | 8s fetch | 15s |
| `/api/search`    | 12s fetch | 20s |

---

## Usage Examples

### JavaScript / fetch

```js
// Fast search with AI answer
const res = await fetch('/api/unified?q=what+is+typescript&mode=fast');
const data = await res.json();

console.log(data.structured.answer);
console.log(data.structured.key_points);
console.log(data.results.search);
```

### JavaScript — POST to synthesiser

```js
const res = await fetch('/api/synthesiser', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    q: 'explain async/await in JavaScript',
    context: [
      { title: 'MDN Async', snippet: 'async functions return a Promise...', url: 'https://developer.mozilla.org' }
    ]
  })
});
const { synthesis } = await res.json();
console.log(synthesis.answer);
```

### Python

```python
import requests

# Full pipeline
r = requests.get('https://your-deployment.vercel.app/api/unified', params={
    'q': 'machine learning basics',
    'mode': 'fast'
})
data = r.json()
print(data['structured']['answer'])
print(data['synthesis']['key_points'])
```

### Tillu MAX agent integration

```js
// Recommended pattern for agent use
async function search(query, category = 'general') {
  const url = new URL('https://your-deployment.vercel.app/api/unified');
  url.searchParams.set('q', query);
  url.searchParams.set('category', category);
  url.searchParams.set('mode', 'fast');

  const res = await fetch(url);
  const data = await res.json();

  if (!data.success) throw new Error(data.error);

  // Prefer structured if available, fall back to synthesis
  const answer = data.structured ?? data.synthesis;
  return {
    answer: answer.answer,
    points: answer.key_points ?? [],
    sources: data.results.search.slice(0, 5),
    videos: data.results.videos,
    latency: data.meta.latency_ms
  };
}
```
