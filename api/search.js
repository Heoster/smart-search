// ──────────────────────────────────────────────
// /api/search?q=...&category=general|videos|news|images
// Proxies search to SearXNG
// ──────────────────────────────────────────────

const SEARXNG_URL = process.env.SEARXNG_URL || 'https://codeex123-tillu-searxng.hf.space';

// Validate SEARXNG_URL at module load time so misconfiguration is caught early.
let _searxBase;
try {
  _searxBase = new URL(SEARXNG_URL);
} catch {
  console.error('[search] SEARXNG_URL is not a valid URL:', SEARXNG_URL);
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

  const { q, category = 'general', pageno = '1' } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ success: false, error: 'Missing ?q= query parameter' });
  }

  const pageNum = parseInt(pageno, 10);
  if (isNaN(pageNum) || pageNum < 1) {
    return res.status(400).json({ success: false, error: 'pageno must be a positive integer' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const url = new URL('/search', _searxBase);
    url.searchParams.set('q', q.trim());
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', category);
    url.searchParams.set('pageno', pageNum);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`SearXNG returned HTTP ${response.status} ${response.statusText}`);
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
      query: q.trim(),
      category,
      pageno: pageNum,
      total: results.length,
      engines: data.engines || [],
      results
    });

  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    const message = isTimeout
      ? `SearXNG timed out after 12s — it may be slow or unreachable`
      : `Search failed: ${err.message}`;

    console.error('[search] Error:', message);
    return res.status(502).json({
      success: false,
      error: message,
      query: q.trim()
    });
  } finally {
    clearTimeout(timeout);
  }
}