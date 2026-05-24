// ──────────────────────────────────────────────
// /api/synthesiser?q=...&context=...
// Groq LLM synthesis of search context
// ──────────────────────────────────────────────

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Accept both GET and POST
  let q, context;
  if (req.method === 'POST') {
    q = req.body?.q;
    context = req.body?.context;
  } else {
    q = req.query.q;
    try { context = JSON.parse(req.query.context || '[]'); } catch { context = []; }
  }

  if (!q) {
    return res.status(400).json({ success: false, error: 'Missing q parameter' });
  }

  if (!GROQ_API_KEY) {
    return res.status(200).json({
      success: true,
      warning: 'GROQ_API_KEY not set — returning raw context',
      synthesis: { answer: 'AI synthesis unavailable — set GROQ_API_KEY', key_points: [], facts: [] },
      context
    });
  }

  try {
    // Build context text
    let contextText = '';
    if (Array.isArray(context)) {
      contextText = context.map((c, i) => {
        let s = `[${i + 1}] ${c.title || 'Untitled'}`;
        if (c.snippet) s += `\n    ${c.snippet}`;
        if (c.content) s += `\n    ${c.content.substring(0, 800)}`;
        if (c.url) s += `\n    Source: ${c.url}`;
        return s;
      }).join('\n\n');
    } else if (typeof context === 'string') {
      contextText = context;
    }

    if (!contextText.trim()) {
      contextText = 'No context available.';
    }

    const prompt = `You are Tillu, an intelligent search assistant. Given the following search results and web content, provide a comprehensive synthesis that answers the user's query.

RULES:
- Be accurate and cite specific facts from the sources
- Be concise but thorough (2-4 paragraphs max)
- Include specific numbers, dates, names when available
- If sources conflict, mention it
- If context is insufficient, say so honestly

Query: ${q}

Context:
${contextText}

Respond in JSON format:
{
  "answer": "your synthesized answer here",
  "key_points": ["point 1", "point 2", "point 3"],
  "facts": ["specific fact 1", "specific fact 2"]
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

    const groqData = await groqRes.json();

    if (!groqData.choices || !groqData.choices[0]) {
      throw new Error('Groq returned no choices');
    }

    let synthesis;
    try {
      synthesis = JSON.parse(groqData.choices[0].message.content);
    } catch {
      synthesis = {
        answer: groqData.choices[0].message.content,
        key_points: [],
        facts: []
      };
    }

    return res.status(200).json({
      success: true,
      query: q,
      synthesis,
      model: GROQ_MODEL
    });

  } catch (err) {
    console.error('Synthesiser error:', err.message);
    return res.status(502).json({
      success: false,
      error: 'Synthesis failed: ' + err.message,
      query: q
    });
  }
}