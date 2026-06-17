# Tillu Smart Search

AI-powered search engine combining **SearXNG** + **Groq LLM** (llama-3.3-70b) + **smart web scraping**.  
All endpoints are CORS-enabled and return JSON.

> **Production Docs**: For full documentation, tutorials, and integration guides, see the [**/docs**](./docs/introduction.md) folder.

---

## 🚀 Quick Start

```bash
# Fast AI-powered search
curl "https://your-api.com/api/unified?q=what+is+rust+programming"
```

## 📖 Documentation Index

- [**Getting Started**](./docs/getting-started.md)
- [**API Reference**](./docs/api/unified.md)
- [**Agent Integration Guide**](./docs/guides/agent-integration.md)
- [**Deployment Guide**](./docs/guides/deployment.md)

---

## 📝 User & Operator Notes

### Production Best Practices
1.  **Vercel Pro**: Use the Vercel Pro plan for production to avoid the 10s timeout limit on the hobby plan, especially when using `mode=full`.
2.  **Groq Tier**: Ensure your Groq account has sufficient rate limits for your expected traffic.
3.  **Private SearXNG**: For high-volume production, host your own SearXNG instance and set the `SEARXNG_URL`.
4.  **Security**: Restrict `Access-Control-Allow-Origin` in `api/unified.js` if you are not building a public API.

### Troubleshooting
- **502 Error**: Usually indicates an upstream timeout from SearXNG or Groq. Check if your SearXNG instance is alive.
- **Empty Synthesis**: If `GROQ_API_KEY` is missing or invalid, synthesis will be disabled.
- **Truncated Content**: Scraping results are capped at 5k characters to maintain performance.

---

## 🛠️ Environment Variables

| Variable | Required | Default |
| :--- | :--- | :--- |
| `GROQ_API_KEY` | ✅ Yes | - |
| `SEARXNG_URL` | ❌ No | `https://tillu-searxng.onrender.com` |

---

## License

MIT © [Tillu Team](https://github.com/your-org)
