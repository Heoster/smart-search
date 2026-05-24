// ──────────────────────────────────────────────
// /api/scraper?url=...
// Smart web scraper — extracts text, title, links
// ──────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ success: false, error: 'Missing ?url= parameter' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    clearTimeout(timeout);

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeHtml(titleMatch[1].trim()) : '';

    // Extract meta description
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i)
      || html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i);
    const description = descMatch ? decodeHtml(descMatch[1].trim()) : '';

    // Remove noise tags
    let clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Extract main content — prefer <article>, <main>, then <body>
    let content = '';
    const articleMatch = clean.match(/<article[\s\S]*?<\/article>/i);
    const mainMatch = clean.match(/<main[\s\S]*?<\/main>/i);

    if (articleMatch) content = articleMatch[0];
    else if (mainMatch) content = mainMatch[0];
    else {
      const bodyMatch = clean.match(/<body[\s\S]*?<\/body>/i);
      content = bodyMatch ? bodyMatch[0] : clean;
    }

    // Strip remaining tags and clean up
    const text = decodeHtml(
      content
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#\d+;/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    );

    // Extract links
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const links = [];
    let m;
    while ((m = linkRegex.exec(html)) !== null && links.length < 15) {
      const href = m[1];
      const linkText = m[2].replace(/<[^>]+>/g, '').trim();
      if (href.startsWith('http') && linkText.length > 2 && linkText.length < 100) {
        links.push({ text: linkText, url: href });
      }
    }

    // Truncate text to ~4000 chars
    const truncated = text.length > 4000 ? text.substring(0, 4000) + '...' : text;

    return res.status(200).json({
      success: true,
      url,
      title,
      description,
      content: truncated,
      contentLength: text.length,
      links
    });

  } catch (err) {
    console.error('Scrape error:', err.message);
    return res.status(502).json({
      success: false,
      error: 'Scraping failed: ' + err.message,
      url
    });
  }
}

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}