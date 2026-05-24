// ──────────────────────────────────────────────
// /api/search?q=...&category=general|videos|news|images
// Proxies search to SearXNG
// ──────────────────────────────────────────────

const SEARXNG_URL = process.env.SEARXNG_URL || 'https://codeex123-tillu-searxng.hf.space';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, category = 'general', pageno = 1 } = req.query;

  if (!q) {
    return res.status(400).json({ success: false, error: 'Missing ?q= query parameter' });
  }

  try {
    const url = new URL('/search', SEARXNG_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', category);
    url.searchParams.set('pageno', pageno);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`SearXNG returned ${response.status}`);
    }

    const data = await response.json();

    const results = (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      engine: r.engine || '',
      category: r.category || '',
      thumbnail: r.thumbnail || '',
      publishedDate: r.publishedDate || null,
      score: r.score || 0
    }));

    return res.status(200).json({
      success: true,
      query: q,
      category,
      total: results.length,
      engines: data.engines || [],
      results
    });

  } catch (err) {
    console.error('Search error:', err.message);
    return res.status(502).json({
      success: false,
      error: 'Search failed: ' + err.message,
      query: q
    });
  }
}