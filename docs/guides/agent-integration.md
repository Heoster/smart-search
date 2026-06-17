# Agent Integration Guide

Tillu Smart Search is designed to be the "eyes and ears" for AI agents. This guide explains how to integrate Tillu as a tool for agents built with frameworks like LangChain, AutoGPT, or custom loops.

## Recommended Integration Pattern

For AI agents, we recommend using the **Unified** endpoint in `fast` mode for general tool-use, and escalating to `full` mode only when the agent specifically requests deep research.

### Tool Definition (OpenAI/JSON Schema)

```json
{
  "name": "tillu_search",
  "description": "Search the web for real-time information and get structured answers.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "The search query or question." },
      "deep_research": { "type": "boolean", "description": "Set to true for complex technical topics." }
    },
    "required": ["query"]
  }
}
```

### Implementation (Node.js Example)

```javascript
async function tilluTool({ query, deep_research }) {
  const mode = deep_research ? 'full' : 'fast';
  const url = `https://your-api.com/api/unified?q=${encodeURIComponent(query)}&mode=${mode}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.success) return `Error: ${data.error}`;

  // Prefer the structured answer for token efficiency
  const result = data.structured || data.synthesis;
  
  return JSON.stringify({
    answer: result.answer,
    key_points: result.key_points,
    sources: data.results.search.slice(0, 3)
  });
}
```

## Tips for Agent Developers

1.  **Token Efficiency**: Use the `structured` object. It provides a dense, 1-3 sentence answer that is ideal for an agent's context window.
2.  **Citation Management**: Always include the `sources` in your agent's memory. This allows the agent to cite its answers accurately.
3.  **Mode Escalation**: If your agent detects that the `fast` mode answer is too generic, prompt it to retry with `deep_research: true`.
4.  **Handling "No Results"**: Tillu will always try to synthesize an answer. If the search results are poor, the LLM will usually state that it couldn't find sufficient information. Train your agent to handle this case.
