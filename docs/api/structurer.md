# API Reference: Structurer

The `/api/llm-structurer` endpoint takes raw data and transforms it into a clean, strictly typed JSON schema optimized for frontend display or agentic consumption.

## Endpoint Details

- **Path**: `/api/llm-structurer`
- **Method**: `GET` | `POST`
- **Authentication**: Requires `GROQ_API_KEY`
- **CORS**: Enabled (`*`)

## Parameters

### GET
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `q` | `string` | ✅ | The original query context. |
| `data` | `string` | ❌ | URL-encoded JSON object containing the raw data. |

### POST (Recommended)
Send a JSON body:
```json
{
  "q": "string",
  "data": "any (JSON Object)"
}
```

## Response Schema

Returns a structured object following this schema:

```json
{
  "success": true,
  "query": "string",
  "structured": {
    "answer": "1-3 sentence direct answer",
    "summary": "2-4 sentence summary",
    "key_points": "string[]",
    "sources": "Source[]",
    "videos": "Video[]",
    "related_topics": "string[]",
    "facts": "string[]",
    "category": "string"
  },
  "model": "llama-3.3-70b-versatile"
}
```

## Logic and Processing

1.  **Context Injection**: The structurer is provided with the original query to ensure the data is framed correctly.
2.  **Schema Enforcement**: Uses Groq's `json_object` response format to ensure the output matches the requested structure.
3.  **Data Pruning**: Large input payloads are truncated at 6,000 characters to focus on the most relevant information.

## Implementation Details

- **Temperature**: Set to `0.2` for maximum deterministic formatting.
- **Timeout**: 20 seconds.
- **Fallback**: If structuring fails, it returns a simplified object with the raw answer.
