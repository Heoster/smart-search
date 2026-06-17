# API Reference: Search

The `/api/search` endpoint provides a raw interface to the underlying SearXNG instance. It returns aggregated search results from multiple engines without any AI processing.

## Endpoint Details

- **Path**: `/api/search`
- **Method**: `GET`
- **Authentication**: None
- **CORS**: Enabled (`*`)

## Query Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `q` | `string` | ✅ | - | The search query. |
| `category` | `string` | ❌ | `general` | Search category: `general`, `videos`, `news`, `images`, `music`, `it`, `science`, `files`, `social`, `map`. |
| `pageno` | `integer` | ❌ | `1` | The results page number. |

## Response Schema

```json
{
  "success": true,
  "query": "string",
  "category": "string",
  "pageno": number,
  "total": number,
  "engines": "string[]",
  "results": "WebResult[]"
}
```

### WebResult Object
```json
{
  "title": "string",
  "url": "string",
  "snippet": "string",
  "engine": "string",
  "category": "string",
  "thumbnail": "string",
  "publishedDate": "string | null",
  "score": "number"
}
```

## Example Usage

```bash
curl "https://your-api.com/api/search?q=machine+learning+papers&category=science"
```

## Implementation Details

- **Aggregator**: Proxies requests to a SearXNG instance.
- **Timeout**: 12 seconds. If the upstream engine is slow, the request will abort with a 502 error.
- **Scoring**: The `score` field is provided by SearXNG and indicates the relevance calculated by the aggregator.
