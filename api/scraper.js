// ──────────────────────────────────────────────
// /api/scraper?url=...
// Smart web scraper — extracts text, title, links
// ──────────────────────────────────────────────

export const MAX_OUTPUT_CHARS = 5000;

export async function scrapePage(url) {
  // Validate URL format
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http/https URLs are allowed');
    }
  } catch (e) {
    return { success: false, error: `Invalid URL: ${e.message}`, url };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    const html = await response.text();

    // Extract title — handle CDATA and whitespace variations
    const titleMatch = html.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const title = titleMatch ? decodeHtml(titleMatch[1].trim()) : '';

    // Extract meta description — both attribute orderings + property="og:description"
    const descMatch =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i) ||
      html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i) ||
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["']/i) ||
      html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+property=["']og:description["']/i);
    const description = descMatch ? decodeHtml(descMatch[1].trim()) : '';

    // Remove noise tags (order matters — scripts/styles first)
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

    // Extract main content — prefer <article>, <main>, then <body>
    const articleMatch = clean.match(/<article[\s\S]*?<\/article>/i);
    const mainMatch = clean.match(/<main[\s\S]*?<\/main>/i);
    const bodyMatch = clean.match(/<body[\s\S]*?<\/body>/i);

    let content = '';
    if (articleMatch) content = articleMatch[0];
    else if (mainMatch) content = mainMatch[0];
    else if (bodyMatch) content = bodyMatch[0];
    else content = clean;

    // Convert block elements to newlines, strip remaining tags
    const rawText = content
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');

    // Decode all HTML entities (including numeric & hex)
    const text = decodeHtml(rawText)
      .replace(/\s{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Extract links (from original html to preserve hrefs)
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const links = [];
    let m;
    while ((m = linkRegex.exec(html)) !== null && links.length < 15) {
      const href = m[1];
      const linkText = m[2].replace(/<[^>]+>/g, '').trim();
      if (href.startsWith('http') && linkText.length > 2 && linkText.length < 120) {
        links.push({ text: linkText, url: href });
      }
    }

    // Truncate at word boundary
    const truncated = truncateAtWord(text, MAX_OUTPUT_CHARS);

    return {
      success: true,
      url,
      title,
      description,
      content: truncated,
      contentLength: text.length,
      truncated: text.length > MAX_OUTPUT_CHARS,
      links
    };

  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    const message = isTimeout
      ? `Page timed out after 8s — it may be slow or blocking scrapers`
      : `Scraping failed: ${err.message}`;

    console.error('[scraper] Error:', message);
    return {
      success: false,
      error: message,
      url
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ success: false, error: 'Missing ?url= parameter' });
  }

  const result = await scrapePage(url);
  
  if (!result.success) {
    return res.status(502).json(result);
  }

  return res.status(200).json(result);
}

// ── Decode HTML entities (named, decimal, hex) ──
export function decodeHtml(str) {
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

// ── Truncate at the last word boundary before maxChars ──
function truncateAtWord(text, maxChars) {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf(' ', maxChars);
  return (cut > 0 ? text.substring(0, cut) : text.substring(0, maxChars)) + '…';
}
