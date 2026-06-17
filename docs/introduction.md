# Introduction

Welcome to the **Tillu Smart Search** documentation.

Tillu Smart Search is a high-performance, AI-powered search infrastructure designed for developers and AI agents. It combines the breadth of traditional search engines with the reasoning capabilities of modern Large Language Models (LLMs) to provide structured, synthesized, and actionable data.

## Why Tillu Smart Search?

Traditional search returns a list of links; Tillu Smart Search returns **answers**. By orchestrating a pipeline of searching, scraping, and LLM processing, Tillu transforms raw web data into clean, structured JSON.

### Core Capabilities

- **Multi-Engine Search**: Leverages SearXNG to aggregate results from dozens of search engines.
- **Smart Web Scraping**: Extracts meaningful content from web pages while stripping away noise (ads, nav, trackers).
- **AI Synthesis**: Uses Groq-powered LLMs (Llama 3.3 70B) to synthesize multi-source data into comprehensive answers.
- **Data Structuring**: Normalizes unstructured web content into consistent, developer-friendly JSON schemas.
- **CORS-Enabled**: Ready to be consumed directly from frontend applications or backend agents.

## How it Works

1.  **Search**: Queries the SearXNG instance for relevant web results.
2.  **Scrape** (Optional): Fetches the full text content of top-ranking pages.
3.  **Synthesize**: Feeds the snippets and scraped content to an LLM to generate a natural language response.
4.  **Structure**: Refines the raw response into a strictly typed JSON object with key points, facts, and sources.

## Documentation Structure

This documentation is organized into four sections:

-   [**Getting Started**](./getting-started.md): A quick tutorial to get your first query running in under 5 minutes.
-   [**API Reference**](./api/unified.md): Detailed technical specifications for every endpoint.
-   [**Concepts**](./concepts/modes-and-pipelines.md): Explanations of how the underlying pipelines and modes function.
-   [**Guides**](./guides/agent-integration.md): Task-oriented guides for integration, deployment, and optimization.
