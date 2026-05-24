// ──────────────────────────────────────────────
// /api/llm-structurer?q=...&data=...
// Structures raw data into clean JSON via Groq
// ──────────────────────────────────────────────

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let q, data;
  if (req.method === 'POST') {
    q = req.body?.q;
    data = req.body?.data;
  } else {
    q = req.query.q;
    try { data = JSON.parse(req.query.data || '{}'); } catch { data = {}; }
  }

  if (!q) {
    return res.status(400).json({ success: false, error: 'Missing q parameter' });
  }

  if (!GROQ_API_KEY) {
    return res.status(200).json({
      success: true,
      warning: 'GROQ_API_KEY not set — returning raw data',
      structured: data
    });
  }

  try {
    const prompt = `You are Tillu, a data structuring assistant. Given a search query and raw data, structure it into clean, useful JSON.

Query: ${q}

Raw Data:
${JSON.stringify(data, null, 2).substring(0, 6000)}

Return a JSON object with EXACTLY this schema:
{
  "answer": "a clear, direct answer to the query in 1-3 sentences",
  "summary": "a longer 2-4 sentence summary",
  "key_points": ["point1", "point2", "point3", "point4", "point5"],
  "sources": [
    {"title": "source title", "url": "source url", "snippet": "brief snippet"}
  ],
  "videos": [
    {"title": "video title", "url": "video url", "thumbnail": "thumbnail url", "duration": "duration if available"}
  ],
  "related_topics": ["topic1", "topic2", "topic3"],
  "facts": ["specific fact 1", "specific fact 2"],
  "category": "the category this query belongs to"
}

Rules:
- Only include fields that have data (omit empty arrays)
- Keep key_points to 3-7 items
- Keep sources to top 5 most relevant
- Keep videos to top 5 most relevant
- Keep facts to 3-5 items
- Be accurate — only use information from the raw data`;

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

    const groqData = await groqRes.json();

    if (!groqData.choices || !groqData.choices[0]) {
      throw new Error('Groq returned no choices');
    }

    let structured;
    try {
      structured = JSON.parse(groqData.choices[0].message.content);
    } catch {
      structured = { answer: groqData.choices[0].message.content };
    }

    return res.status(200).json({
      success: true,
      query: q,
      structured,
      model: GROQ_MODEL
    });

  } catch (err) {
    console.error('Structurer error:', err.message);
    return res.status(502).json({
      success: false,
      error: 'Structuring failed: ' + err.message,
      query: q
    });
  }
}