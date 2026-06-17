# API Reference: Scraper

The `/api/scraper` endpoint extracts clean, readable text content from any public web page. It is optimized for feeding content into Large Language Models by removing non-essential HTML elements.

## Endpoint Details

- **Path**: `/api/scraper`
- **Method**: `GET`
- **Authentication**: None
- **CORS**: Enabled (`*`)

## Query Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `url` | `string` | ✅ | The full URL of the page to scrape (must include `http://` or `https://`). |

## Response Schema

```json
{
  "success": true,
  "url": "string",
  "title": "string",
  "description": "string",
  "content": "string",
  "contentLength": number,
  "truncated": boolean,
  "links": "LinkObject[]"
}
```

### LinkObject
```json
{
  "text": "string",
  "url": "string"
}
```

## Content Extraction Logic

The scraper follows a "Readability-first" heuristic:
1.  **Noise Removal**: Strips `<script>`, `<style>`, `<svg>`, `<nav>`, `<header>`, `<footer>`, and `<aside>`.
2.  **Element Priority**: Prefers content within `<article>`, then `<main>`, then `<body>`.
3.  **Formatting**: Converts breaks, paragraphs, and list items into appropriate newline characters for LLM readability.
4.  **Trimming**: Limits output to the first 5,000 characters.

## Error Handling

| Status | Message | Description |
| :--- | :--- | :--- |
| `400` | `Missing ?url= parameter` | No URL was provided. |
| `400` | `Invalid URL` | The provided string is not a valid URL. |
| `502` | `Fetch failed` | The page could not be reached or timed out (8s limit). |

## Implementation Details

- **User Agent**: Uses a modern Chrome User-Agent to minimize bot detection.
- **Timeout**: 8 seconds for the fetch operation.
- **Truncation**: If the page content exceeds 5,000 characters, `truncated` is set to `true`.
