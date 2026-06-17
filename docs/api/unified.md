# API Reference: Unified

The `/api/unified` endpoint is the primary interface for Tillu Smart Search. It orchestrates the entire pipeline: **Search → Scrape (optional) → Synthesize → Structure**.

## Endpoint Details

- **Path**: `/api/unified`
- **Method**: `GET`
- **Authentication**: None (Requires `GROQ_API_KEY` to be set in server environment)
- **CORS**: Enabled (`*`)

## Query Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `q` | `string` | ✅ | - | The search query or question. |
| `category` | `string` | ❌ | `general` | Search category: `general`, `videos`, `news`, `images`. |
| `mode` | `string` | ❌ | `fast` | Processing mode: `fast`, `full`, or `search`. |

### Modes of Operation

| Mode | Pipeline Steps | Avg Latency | Best For |
| :--- | :--- | :--- | :--- |
| `fast` | Search + AI Synthesis + Structuring | 3-8s | Most queries, quick answers. |
| `full` | Search + Scrape (top 3) + AI Synthesis + Structuring | 8-20s | Complex queries requiring deep info. |
| `search` | Raw Search Results only (No AI) | 1-3s | Simple listing of links. |

## Response Schema

Returns a JSON object with the following structure:

```json
{
  "success": true,
  "query": "string",
  "category": "string",
  "mode": "string",
  "results": {
    "search": "WebResult[]",
    "videos": "VideoResult[]",
    "scraped": "ScrapeMeta[]"
  },
  "synthesis": "SynthesisObject",
  "structured": "StructuredObject",
  "meta": "MetadataObject"
}
```

### Response Objects

#### WebResult
```json
{
  "title": "string",
  "url": "string",
  "snippet": "string",
  "engine": "string",
  "category": "string",
  "thumbnail": "string",
  "publishedDate": "ISO-8601 | null",
  "score": "number"
}
```

#### VideoResult
```json
{
  "title": "string",
  "url": "string",
  "thumbnail": "string",
  "snippet": "string",
  "engine": "string",
  "publishedDate": "string | null"
}
```

#### SynthesisObject (Raw LLM Output)
```json
{
  "answer": "string (2-4 paragraphs)",
  "key_points": "string[]",
  "facts": "string[]"
}
```

#### StructuredObject (Refined Schema)
```json
{
  "answer": "string (1-3 sentences)",
  "summary": "string (2-4 sentences)",
  "key_points": "string[]",
  "sources": "WebResult[]",
  "videos": "VideoResult[]",
  "related_topics": "string[]",
  "facts": "string[]",
  "category": "string"
}
```

## Error Handling

| Status | Error Code | Description |
| :--- | :--- | :--- |
| `400` | `Missing ?q= query parameter` | The query parameter `q` was not provided. |
| `502` | `SearXNG timed out` | The upstream search engine failed to respond within 12s. |
| `500` | `Server misconfiguration` | Invalid `SEARXNG_URL` or internal server error. |

## Implementation Details

- **Graceful Degradation**: If `GROQ_API_KEY` is not configured, the service returns raw search results with a notice in the `synthesis.answer` field.
- **Timeout Management**: 
    - Search: 12 seconds.
    - Scrape: 6 seconds per page.
    - Groq LLM: 20 seconds.
- **Character Limits**: Context sent to the LLM is capped at 12,000 characters to ensure fast processing and cost efficiency.
