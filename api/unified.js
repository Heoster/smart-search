// ──────────────────────────────────────────────
// /api/unified?q=...&category=general|videos|news&mode=full|fast|search
// Full pipeline: search → scrape → synthesize → structure
// ──────────────────────────────────────────────

const SEARXNG_URL = process.env.SEARXNG_URL || 'https://codeex123-tillu-searxng.hf.space';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Maximum total characters of context sent to each Groq call (≈3 000 tokens)
const MAX_CONTEXT_CHARS = 12000;
// Maximum characters of structured data payload (≈1 500 tokens)
const MAX_STRUCT_CHARS = 6000;
// Output character limit for scraped page content
const MAX_SCRAPE_CHARS = 4000;

// Video platform hostnames / URL fragments
const VIDEO_HOSTS = new Set([
  'youtube.com', 'youtu.be', 'dailymotion.com', 'vimeo.com',
  'peertube', 'twitch.tv', 'rumble.com', 'bitchute.com', 'odysee.com'
]);

// Validate SEARXNG_URL at module load time
let _searxBase;
try {
  _searxBase = new URL(SEARXNG_URL);
} catch {
  console.error('[unified] SEARXNG_URL is not a valid URL:', SEARXNG_URL);
  _searxBase = null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!_searxBase) {
    return res.status(500).json({
      success: false,
      error: 'Server misconfiguration: SEARXNG_URL is invalid'
    });
  }

  const startTime = Date.now();
  const { q, category = 'general', mode = 'fast' } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ success: false, error: 'Missing ?q= query parameter' });
  }

  const query = q.trim();
  const meta = { engines_used: [], total_results: 0, scraped_pages: 0, latency_ms: 0 };

  try {
    // ── STEP 1: Search SearXNG ──
    const searchResults = await searchSearXNG(query, category);
    meta.engines_used = searchResults.engines;
    meta.total_results = searchResults.results.length;

    // If mode=search, return early with raw results
    if (mode === 'search') {
      meta.latency_ms = Date.now() - startTime;
      return res.status(200).json({
        success: true,
        query,
        category,
        mode,
        results: { search: searchResults.results },
        synthesis: null,
        structured: null,
        meta
      });
    }

    // Separate video results using URL & category heuristics
    const videos = searchResults.results.filter(r => isVideoResult(r));
    const videoUrls = new Set(videos.map(v => v.url));
    const webResults = searchResults.results.filter(r => !videoUrls.has(r.url));

    // ── STEP 2: Scrape top pages (mode=full only) ──
    let scraped = [];
    if (mode === 'full') {
      const topUrls = webResults
        .filter(r => r.url && r.url.startsWith('http'))
        .slice(0, 3)
        .map(r => r.url);

      const settled = await Promise.allSettled(topUrls.map(url => scrapePage(url)));
      scraped = settled
        .filter(r => r.status === 'fulfilled' && r.value?.success)
        .map(r => r.value);
      meta.scraped_pages = scraped.length;
    }

    // ── STEP 3: Build context for synthesis ──
    const contextItems = [
      ...webResults.map(r => ({
        title: r.title,
        snippet: r.snippet,
        url: r.url,
        content: ''
      })),
      ...scraped.map(s => ({
        title: s.title,
        snippet: s.description,
        url: s.url,
        content: s.content ? s.content.substring(0, 1500) : ''
      }))
    ];

    // ── STEP 4: Synthesize + Structure with Groq (graceful degradation) ──
    let synthesis = null;
    let structured = null;

    if (GROQ_API_KEY) {
      try {
        synthesis = await groqSynthesize(query, contextItems);
      } catch (err) {
        console.error('[unified] Groq synthesis error:', err.message);
        synthesis = {
          answer: `AI synthesis unavailable — ${err.message}`,
          key_points: [],
          facts: []
        };
      }

      // Only attempt structuring if synthesis succeeded (not a fallback)
      if (synthesis && synthesis.answer && !synthesis.answer.startsWith('AI synthesis unavailable')) {
        try {
          structured = await groqStructure(query, {
            synthesis,
            search_results: webResults.slice(0, 8).map(r => ({
              title: r.title,
              url: r.url,
              snippet: r.snippet
            })),
            videos: videos.slice(0, 5).map(v => ({
              title: v.title,
              url: v.url,
              thumbnail: v.thumbnail
            })),
            scraped: scraped.map(s => ({
              title: s.title,
              url: s.url,
              content: s.content?.substring(0, 500)
            }))
          });
        } catch (err) {
          console.error('[unified] Groq structure error:', err.message);
          // structured stays null — frontend should fall back to raw synthesis
        }
      }
    } else {
      synthesis = { answer: 'Set GROQ_API_KEY to enable AI synthesis', key_points: [], facts: [] };
    }

    meta.latency_ms = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      query,
      category,
      mode,
      results: {
        search: webResults.slice(0, 10),
        videos: videos.slice(0, 8).map(v => ({
          title: v.title,
          url: v.url,
          thumbnail: v.thumbnail,
          snippet: v.snippet,
          engine: v.engine,
          publishedDate: v.publishedDate
        })),
        scraped: scraped.map(s => ({
          title: s.title,
          url: s.url,
          contentLength: s.contentLength
        }))
      },
      synthesis,
      structured,
      meta
    });

  } catch (err) {
    // Top-level catch — search itself failed
    console.error('[unified] Fatal error:', err.message);
    meta.latency_ms = Date.now() - startTime;
    return res.status(502).json({
      success: false,
      error: err.name === 'AbortError'
        ? 'SearXNG timed out after 12s — it may be slow or unreachable'
        : err.message,
      query,
      meta
    });
  }
}

// ────────────────────────────────────────────────────────
// Helper: Determine if a result is a video
// ────────────────────────────────────────────────────────
function isVideoResult(r) {
  if (r.category === 'videos') return true;
  if (!r.url) return false;
  try {
    const host = new URL(r.url).hostname.replace('www.', '');
    if (VIDEO_HOSTS.has(host)) return true;
    // Partial match for peertube instances
    if (host.includes('peertube') || host.includes('tube.')) return true;
  } catch {
    // Malformed URL — not a video
  }
  return false;
}

// ────────────────────────────────────────────────────────
// Helper: Search SearXNG
// ────────────────────────────────────────────────────────
async function searchSearXNG(query, category) {
  const url = new URL('/search', _searxBase);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('categories', category);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`SearXNG returned HTTP ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      results: (data.results || []).map(r => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || '',
        engine: r.engine || '',
        category: r.category || '',
        thumbnail: r.thumbnail || '',
        publishedDate: r.publishedDate || null,
        score: r.score || 0
      })),
      engines: data.engines || []
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ────────────────────────────────────────────────────────
// Helper: Scrape a single page
// Kept in sync with api/scraper.js logic
// ────────────────────────────────────────────────────────
async function scrapePage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const title = titleMatch ? decodeHtml(titleMatch[1].trim()) : '';

    // Extract meta description (both attribute orderings + og:description)
    const descMatch =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i) ||
      html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i) ||
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["']/i) ||
      html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+property=["']og:description["']/i);
    const description = descMatch ? decodeHtml(descMatch[1].trim()) : '';

    // Remove noise tags
    let clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '');

    // Prefer <article>, <main>, then <body>
    const articleMatch = clean.match(/<article[\s\S]*?<\/article>/i);
    const mainMatch = clean.match(/<main[\s\S]*?<\/main>/i);
    const bodyMatch = clean.match(/<body[\s\S]*?<\/body>/i);
    const content = articleMatch?.[0] ?? mainMatch?.[0] ?? bodyMatch?.[0] ?? clean;

    const rawText = content
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');

    const text = decodeHtml(rawText)
      .replace(/\s{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      success: true,
      url,
      title,
      description,
      content: text.substring(0, MAX_SCRAPE_CHARS),
      contentLength: text.length
    };

  } catch (err) {
    // Swallow errors — Promise.allSettled handles them, but throw with context
    throw new Error(`scrapePage(${url}): ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ────────────────────────────────────────────────────────
// Helper: Groq Synthesis
// ────────────────────────────────────────────────────────
async function groqSynthesize(query, contextItems) {
  let contextText = contextItems.map((c, i) => {
    let s = `[${i + 1}] ${c.title || 'Untitled'}`;
    if (c.snippet) s += `\n    ${c.snippet.substring(0, 300)}`;
    if (c.content) s += `\n    ${c.content.substring(0, 600)}`;
    if (c.url) s += `\n    Source: ${c.url}`;
    return s;
  }).join('\n\n');

  if (contextText.length > MAX_CONTEXT_CHARS) {
    contextText = contextText.substring(0, MAX_CONTEXT_CHARS) + '\n[...context truncated...]';
  }

  const prompt = `You are Tillu, an intelligent search assistant. Synthesize the following context into a clear answer.

Query: ${query}

Context:
${contextText}

Respond ONLY with valid JSON (no markdown fences):
{
  "answer": "comprehensive answer in 2-4 paragraphs",
  "key_points": ["point1", "point2", "point3", "point4", "point5"],
  "facts": ["specific fact 1", "specific fact 2", "specific fact 3"]
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let groqRes;
  try {
    groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: 'json_object' }
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!groqRes.ok) {
    const errText = await groqRes.text().catch(() => '');
    throw new Error(`Groq API error ${groqRes.status}: ${errText.substring(0, 200)}`);
  }

  const data = await groqRes.json();

  if (!data.choices?.[0]?.message?.content) {
    throw new Error('Groq returned no content');
  }

  try {
    const parsed = JSON.parse(stripMarkdownJson(data.choices[0].message.content));
    parsed.key_points = Array.isArray(parsed.key_points) ? parsed.key_points : [];
    parsed.facts = Array.isArray(parsed.facts) ? parsed.facts : [];
    return parsed;
  } catch {
    return { answer: data.choices[0].message.content, key_points: [], facts: [] };
  }
}

// ────────────────────────────────────────────────────────
// Helper: Groq Structure
// ────────────────────────────────────────────────────────
async function groqStructure(query, rawData) {
  let dataStr = JSON.stringify(rawData, null, 2);
  if (dataStr.length > MAX_STRUCT_CHARS) {
    dataStr = dataStr.substring(0, MAX_STRUCT_CHARS) + '\n  "...": "[data truncated]"\n}';
  }

  const prompt = `Structure this data into clean JSON for the query: "${query}"

Data:
${dataStr}

Return JSON with this schema (omit empty arrays):
{
  "answer": "1-3 sentence direct answer",
  "summary": "2-4 sentence summary",
  "key_points": ["point1", "point2", "point3"],
  "sources": [{"title": "...", "url": "...", "snippet": "..."}],
  "videos": [{"title": "...", "url": "...", "thumbnail": "..."}],
  "related_topics": ["topic1", "topic2", "topic3"],
  "facts": ["fact1", "fact2"],
  "category": "query category"
}

Respond ONLY with valid JSON — no markdown fences, no extra text.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let groqRes;
  try {
    groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 2048,
        response_format: { type: 'json_object' }
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!groqRes.ok) {
    const errText = await groqRes.text().catch(() => '');
    throw new Error(`Groq API error ${groqRes.status}: ${errText.substring(0, 200)}`);
  }

  const data = await groqRes.json();

  if (!data.choices?.[0]?.message?.content) {
    throw new Error('Groq returned no content');
  }

  try {
    return JSON.parse(stripMarkdownJson(data.choices[0].message.content));
  } catch {
    return { answer: data.choices[0].message.content };
  }
}

// ────────────────────────────────────────────────────────
// Shared: Decode HTML entities (named, decimal, hex)
// ────────────────────────────────────────────────────────
function decodeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

// ────────────────────────────────────────────────────────
// Shared: Strip markdown code fences from LLM output
// ────────────────────────────────────────────────────────
function stripMarkdownJson(str) {
  if (!str) return str;
  return str
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}