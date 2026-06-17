# Getting Started

This guide will help you set up and start using Tillu Smart Search in under 5 minutes.

## Prerequisites

Before you begin, ensure you have:

1.  **Node.js 18+** installed.
2.  A **Groq API Key**. You can get one for free at [console.groq.com](https://console.groq.com).
3.  (Optional) A **SearXNG** instance URL. By default, the service uses `https://tillu-searxng.onrender.com`.

## 1. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-repo/tillu-smart-search.git
cd tillu-smart-search
npm install
```

## 2. Environment Configuration

Create a `.env` file in the root directory and add your Groq API key:

```env
GROQ_API_KEY=your_groq_api_key_here
```

## 3. Running Locally

The easiest way to run the service locally is using the Vercel CLI, which mocks the serverless environment:

```bash
npm run dev
```

The API Tester will be available at `http://localhost:3000`.

## 4. Your First API Call

Open your terminal and run the following `curl` command to test the unified pipeline:

```bash
curl "http://localhost:3000/api/unified?q=what+is+typescript&mode=fast"
```

### Understanding the Response

You will receive a JSON response containing:
- `results.search`: Top 10 web results.
- `synthesis.answer`: A 2-4 paragraph natural language answer.
- `structured`: A clean JSON object containing `answer`, `summary`, `key_points`, and `sources`.

## 5. Next Steps

-   **Deep Search**: Try `mode=full` to enable web scraping for richer answers.
-   **Explore Endpoints**: Check out the [API Reference](./api/unified.md) for individual tools like the Scraper or Synthesiser.
-   **Deploy**: Learn how to [deploy to Vercel](./guides/deployment.md).
