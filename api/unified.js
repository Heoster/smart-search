// ──────────────────────────────────────────────
// /api/unified?q=...&category=general|videos|news&mode=full|fast|search
// Full pipeline: search → scrape → synthesize → structure
// ──────────────────────────────────────────────

const SEARXNG_URL = process.env.SEARXNG_URL || 'https://tillu-searxng.onrender.com';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

import { scrapePage, decodeHtml, MAX_OUTPUT_CHARS as MAX_SCRAPE_CHARS } from './scraper.js';
import { groqSynthesize, groqStructure } from './lib/llm.js';

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

      // Use imported scrapePage from scraper.js
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

    // ── STEP 4: Synthesize + Structure with LLM (graceful degradation) ──
    let synthesis = null;
    let structured = null;

    if (GROQ_API_KEY) {
      try {
        synthesis = await groqSynthesize(query, contextItems);
      } catch (err) {
        console.error('[unified] LLM synthesis error:', err.message);
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
          console.error('[unified] LLM structure error:', err.message);
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