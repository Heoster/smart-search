// ──────────────────────────────────────────────
// /api/unified?q=...&category=general|videos|news&mode=full|fast|search
// Full pipeline: search → scrape → synthesize → structure
// ──────────────────────────────────────────────

const SEARXNG_URL = process.env.SEARXNG_URL || 'https://codeex123-tillu-searxng.hf.space';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const startTime = Date.now();
  const { q, category = 'general', mode = 'fast' } = req.query;

  if (!q) {
    return res.status(400).json({ success: false, error: 'Missing ?q= query parameter' });
  }

  const meta = { engines_used: [], total_results: 0, scraped_pages: 0, latency_ms: 0 };

  try {
    // ── STEP 1: Search SearXNG ──
    const searchResults = await searchSearXNG(q, category);
    meta.engines_used = searchResults.engines;
    meta.total_results = searchResults.results.length;

    // If mode=search, return early
    if (mode === 'search') {
      meta.latency_ms = Date.now() - startTime;
      return res.status(200).json({
        success: true,
        query: q,
        category,
        mode,
        results: { search: searchResults.results },
        synthesis: null,
        structured: null,
        meta
      });
    }

    // Separate video results
    const videos = searchResults.results
      .filter(r => r.thumbnail && (r.category === 'videos' || r.url.includes('youtube') || r.url.includes('dailymotion') || r.url.includes('peertube')))
      .map(v => ({
        title: v.title,
        url: v.url,
        thumbnail: v.thumbnail,
        snippet: v.snippet,
        engine: v.engine,
        publishedDate: v.publishedDate
      }));

    const videoUrls = new Set(videos.map(v => v.url));
    const webResults = searchResults.results.filter(r => !videoUrls.has(r.url));

    // ── STEP 2: Scrape top pages (if mode=full) ──
    let scraped = [];
    if (mode === 'full') {
      const topUrls = webResults
        .filter(r => r.url && r.url.startsWith('http'))
        .slice(0, 3)
        .map(r => r.url);

      scraped = await Promise.allSettled(
        topUrls.map(url => scrapePage(url))
      );
      scraped = scraped
        .filter(r => r.status === 'fulfilled' && r.value.success)
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

    // ── STEP 4: Synthesize with Groq ──
    let synthesis = null;
    let structured = null;

    if (GROQ_API_KEY) {
      try {
        synthesis = await groqSynthesize(q, contextItems);

        // ── STEP 5: Structure with Groq ──
        structured = await groqStructure(q, {
          synthesis,
          search_results: webResults.slice(0, 8).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
          videos: videos.slice(0, 5),
          scraped: scraped.map(s => ({ title: s.title, url: s.url, content: s.content?.substring(0, 500) }))
        });
      } catch (err) {
        console.error('Groq pipeline error:', err.message);
        synthesis = { answer: 'AI synthesis unavailable — ' + err.message, key_points: [], facts: [] };
        structured = null;
      }
    } else {
      synthesis = { answer: 'Set GROQ_API_KEY to enable AI synthesis', key_points: [], facts: [] };
    }

    meta.latency_ms = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      query: q,
      category,
      mode,
      results: {
        search: webResults.slice(0, 10),
        videos: videos.slice(0, 8),
        scraped: scraped.map(s => ({ title: s.title, url: s.url, contentLength: s.contentLength }))
      },
      synthesis,
      structured,
      meta
    });

  } catch (err) {
    console.error('Unified error:', err.message);
    meta.latency_ms = Date.now() - startTime;
    return res.status(502).json({
      success: false,
      error: err.message,
      query: q,
      meta
    });
  }
}

// ── Helper: Search SearXNG ──
async function searchSearXNG(query, category) {
  const url = new URL('/search', SEARXNG_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('categories', category);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  const response = await fetch(url.toString(), {
    signal: controller.signal,
    headers: { 'Accept': 'application/json' }
  });
  clearTimeout(timeout);

  if (!response.ok) throw new Error(`SearXNG returned ${response.status}`);

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
}

// ── Helper: Scrape a page ──
async function scrapePage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.5'
    }
  });
  clearTimeout(timeout);

  const html = await response.text();

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i)
    || html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i);
  const description = descMatch ? descMatch[1].trim() : '';

  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  const articleMatch = clean.match(/<article[\s\S]*?<\/article>/i);
  const mainMatch = clean.match(/<main[\s\S]*?<\/main>/i);
  let content = articleMatch ? articleMatch[0] : mainMatch ? mainMatch[0] : clean;

  const text = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    success: true,
    url,
    title,
    description,
    content: text.substring(0, 4000),
    contentLength: text.length
  };
}

// ── Helper: Groq Synthesis ──
async function groqSynthesize(query, contextItems) {
  const contextText = contextItems.map((c, i) => {
    let s = `[${i + 1}] ${c.title || 'Untitled'}`;
    if (c.snippet) s += `\n    ${c.snippet}`;
    if (c.content) s += `\n    ${c.content.substring(0, 600)}`;
    if (c.url) s += `\n    Source: ${c.url}`;
    return s;
  }).join('\n\n');

  const prompt = `You are Tillu, an intelligent search assistant. Synthesize the following context into a clear answer.

Query: ${query}

Context:
${contextText.substring(0, 8000)}

Return JSON:
{
  "answer": "comprehensive answer in 2-4 paragraphs",
  "key_points": ["point1", "point2", "point3", "point4", "point5"],
  "facts": ["specific fact 1", "specific fact 2", "specific fact 3"]
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  const groqRes = await fetch(GROQ_URL, {
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
  clearTimeout(timeout);

  const data = await groqRes.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { answer: data.choices[0].message.content, key_points: [], facts: [] };
  }
}

// ── Helper: Groq Structure ──
async function groqStructure(query, rawData) {
  const prompt = `Structure this data into clean JSON for the query: "${query}"

Data:
${JSON.stringify(rawData, null, 2).substring(0, 6000)}

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
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  const groqRes = await fetch(GROQ_URL, {
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
  clearTimeout(timeout);

  const data = await groqRes.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { answer: data.choices[0].message.content };
  }
}