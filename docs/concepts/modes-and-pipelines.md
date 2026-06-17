# Modes and Pipelines

Tillu Smart Search operates on a tiered pipeline architecture. Understanding these tiers is crucial for optimizing your application's performance and cost.

## The Tiered Pipeline

The `/api/unified` endpoint dynamically adjusts its pipeline based on the `mode` parameter.

### 1. Search Only (`mode=search`)
This is the base tier.
- **Workflow**: Client Request → SearXNG → Client Response.
- **Latency**: 1-3 seconds.
- **Use Case**: When you only need a list of links or want to perform your own processing on raw data.

### 2. Fast AI (`mode=fast`)
This is the default and recommended tier for most use cases.
- **Workflow**: Client Request → SearXNG → Groq LLM (Synthesis) → Groq LLM (Structuring) → Client Response.
- **Latency**: 3-8 seconds.
- **Use Case**: General purpose questions where snippets from search results provide enough context for an accurate answer.

### 3. Full Deep Search (`mode=full`)
The highest tier, providing maximum accuracy and depth.
- **Workflow**: Client Request → SearXNG → Web Scraper (Top 3) → Groq LLM (Synthesis) → Groq LLM (Structuring) → Client Response.
- **Latency**: 8-20 seconds.
- **Use Case**: Technical research, complex troubleshooting, or when search snippets are insufficient.

## Internal Processing Rules

### Context Window Optimization
Tillu uses a "Swiss Army Knife" approach to context management. We prioritize data based on relevance:
1.  **Scraped Content**: High-density information from full pages.
2.  **Search Snippets**: Broad coverage from up to 10 results.
3.  **Metadata**: Titles and URLs for citation accuracy.

Total context is capped at **12,000 characters**. This ensures we stay within the "sweet spot" of the Llama 3.3 model's attention span while maintaining high throughput.

### Graceful Degradation
If any component of the pipeline fails, Tillu attempts to return the best possible partial result:
- **Groq Down?**: Returns raw search results with an error notice.
- **Scraper Blocked?**: Falls back to search snippets for that specific URL.
- **SearXNG Timeout?**: Aborts the request to prevent long-hanging connections.
