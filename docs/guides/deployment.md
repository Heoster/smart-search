# Deployment Guide

Tillu Smart Search is optimized for serverless environments, specifically **Vercel**.

## 1. Deploy to Vercel (Recommended)

### Using the Vercel CLI
```bash
npm run deploy
```

### Using GitHub Integration
1.  Push your code to a GitHub/GitLab/Bitbucket repository.
2.  Import the project into the [Vercel Dashboard](https://vercel.com/new).
3.  Add the required **Environment Variables**.

## 2. Environment Variables

| Variable | Required | Description |
| :--- | :--- | :--- |
| `GROQ_API_KEY` | ✅ | Your API key from [console.groq.com](https://console.groq.com). |
| `SEARXNG_URL` | ❌ | Base URL for SearXNG. Defaults to `https://tillu-searxng.onrender.com`. |

## 3. Custom SearXNG Setup

For production use, we recommend hosting your own SearXNG instance to avoid rate limits and ensure maximum privacy. You can deploy SearXNG on platforms like **Railway**, **Render**, or a custom **VPS** using Docker.

Once your instance is running, update the `SEARXNG_URL` environment variable.

## 4. Scaling and Limits

-   **Timeouts**: Vercel's hobby plan has a 10s execution limit, which may cause timeouts for `mode=full`. For production, the **Vercel Pro** plan (up to 300s) is recommended.
-   **Rate Limits**: 
    - **Groq**: Depends on your Groq plan tier.
    - **SearXNG**: Depends on the instance configuration.
-   **CORS**: The service has `Access-Control-Allow-Origin: *` by default. You can restrict this in `api/unified.js` for production security.
