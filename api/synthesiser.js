// ──────────────────────────────────────────────
// /api/synthesiser?q=...&context=...
// Groq LLM synthesis of search context
// ──────────────────────────────────────────────

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Model fallback chain — tries fastest first, falls back on 429
const GROQ_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'allam-2-7b',
];

const MAX_CONTEXT_CHARS = 6000;  // reduced from 12000 to stay under TPM

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

  if (!q || !q.trim()) {
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
    // Build context text with per-source limits
    let contextText = '';
    if (Array.isArray(context)) {
      contextText = context.map((c, i) => {
        let s = `[${i + 1}] ${c.title || 'Untitled'}`;
        if (c.snippet) s += `\n    ${c.snippet.substring(0, 300)}`;
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

    // Hard cap to avoid token limit errors
    if (contextText.length > MAX_CONTEXT_CHARS) {
      contextText = contextText.substring(0, MAX_CONTEXT_CHARS) + '\n[...context truncated...]';
    }

    const prompt = `You are Tillu, an intelligent search assistant. Given the following search results and web content, provide a comprehensive synthesis that answers the user's query.

RULES:
- Be accurate and cite specific facts from the sources
- Be concise but thorough (2-4 paragraphs max)
- Include specific numbers, dates, names when available
- If sources conflict, mention it
- If context is insufficient, say so honestly
- Respond ONLY with valid JSON — no markdown fences, no extra text

Query: ${q.trim()}

Context:
${contextText}

Return this JSON object:
{
  "answer": "your synthesized answer here",
  "key_points": ["point 1", "point 2", "point 3"],
  "facts": ["specific fact 1", "specific fact 2"]
}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    let groqRes;
    let usedModel = GROQ_MODELS[0];
    let lastError;

    for (const model of GROQ_MODELS) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      try {
        groqRes = await fetch(GROQ_URL, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 800,
            response_format: { type: 'json_object' }
          })
        });
        clearTimeout(t);
        if (groqRes.status === 429) {
          console.warn(`[synthesiser] ${model} rate limited, trying next...`);
          lastError = new Error(`Rate limited on ${model}`);
          groqRes = null;
          continue;
        }
        usedModel = model;
        break;
      } catch (e) {
        clearTimeout(t);
        lastError = e;
        groqRes = null;
      }
    }
    clearTimeout(timeout);

    if (!groqRes) {
      throw lastError ?? new Error('All Groq models failed');
    }

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => '');
      throw new Error(`Groq API error ${groqRes.status}: ${errText.substring(0, 200)}`);
    }

    const groqData = await groqRes.json();

    if (!groqData.choices?.[0]?.message?.content) {
      throw new Error('Groq returned no content');
    }

    const rawContent = groqData.choices[0].message.content;

    let synthesis;
    try {
      synthesis = JSON.parse(stripMarkdownJson(rawContent));
    } catch {
      synthesis = {
        answer: rawContent,
        key_points: [],
        facts: []
      };
    }

    // Ensure required fields exist
    synthesis.key_points = Array.isArray(synthesis.key_points) ? synthesis.key_points : [];
    synthesis.facts = Array.isArray(synthesis.facts) ? synthesis.facts : [];

    return res.status(200).json({
      success: true,
      query: q.trim(),
      synthesis,
      model: usedModel
    });

  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    const message = isTimeout
      ? 'Groq request timed out after 20s'
      : `Synthesis failed: ${err.message}`;

    console.error('[synthesiser] Error:', message);
    return res.status(502).json({
      success: false,
      error: message,
      query: q.trim()
    });
  }
}

// ── Strip markdown code fences (```json ... ```) from LLM output ──
function stripMarkdownJson(str) {
  if (!str) return str;
  // Remove leading/trailing ``` or ```json fences
  return str
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}