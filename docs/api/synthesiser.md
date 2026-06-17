# API Reference: Synthesiser

The `/api/synthesiser` endpoint uses the Groq Llama 3.3 70B model to generate a comprehensive, natural language answer based on a query and provided context.

## Endpoint Details

- **Path**: `/api/synthesiser`
- **Method**: `GET` | `POST`
- **Authentication**: Requires `GROQ_API_KEY`
- **CORS**: Enabled (`*`)

## Parameters

### GET
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `q` | `string` | ✅ | The question to answer. |
| `context` | `string` | ❌ | URL-encoded JSON array of `ContextObject`. |

### POST (Recommended)
Send a JSON body:
```json
{
  "q": "string",
  "context": "ContextObject[]"
}
```

### ContextObject
```json
{
  "title": "string",
  "snippet": "string",
  "url": "string",
  "content": "string (optional)"
}
```

## Response Schema

```json
{
  "success": true,
  "query": "string",
  "synthesis": {
    "answer": "string",
    "key_points": "string[]",
    "facts": "string[]"
  },
  "model": "llama-3.3-70b-versatile"
}
```

## Example Usage (POST)

```bash
curl -X POST "https://your-api.com/api/synthesiser" \
  -H "Content-Type: application/json" \
  -d '{
    "q": "benefits of exercise",
    "context": [
      { "title": "Mayo Clinic", "snippet": "Exercise controls weight and combats health conditions." }
    ]
  }'
```

## Implementation Details

- **Model**: `llama-3.3-70b-versatile` via Groq Cloud.
- **Context Limit**: Total context is truncated at 12,000 characters to prevent token overflow.
- **Temperature**: Set to `0.3` for a balance between accuracy and fluency.
- **Timeout**: 20 seconds for the LLM generation.
