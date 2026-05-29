// ──────────────────────────────────────────────
// /api/llm-structurer?q=...&data=...
// Structures raw data into clean JSON via Groq
// ──────────────────────────────────────────────

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const LLM_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'gpt-oss-20b',
];

// Maximum characters of raw data serialized into the prompt
const MAX_DATA_CHARS = 6000;

// ────────────────────────────────────────────────────────
// Helper: Call LLM with model fallback chain
// Tries each model in LLM_MODELS until one succeeds
// ────────────────────────────────────────────────────────
async function callLLM(prompt, maxTokens = 800) {
  let lastError;
  for (const model of LLM_MODELS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20-second timeout

    try {
      if (!GROQ_API_KEY) {
        lastError = new Error('GROQ_API_KEY is not set');
        continue;
      }

      const llmRes = await fetch(GROQ_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2, // Lower temperature for structuring
          max_tokens: maxTokens,
          response_format: { type: 'json_object' }
        })
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text().catch(() => '');
        if (llmRes.status === 429) {
          console.warn(`[llm-structurer] ${model} rate limited, trying next model...`);
          lastError = new Error(`Groq API error ${llmRes.status}: ${errText.substring(0, 100)}`);
          continue;
        }
        throw new Error(`Groq API error ${llmRes.status}: ${errText.substring(0, 200)}`);
      }

      const data = await llmRes.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Groq returned no content');
      return { content, model };

    } catch (e) {
      if (e.name === 'AbortError') {
        lastError = new Error(`Groq request timed out (model: ${model})`);
        continue;
      }
      if (e.message?.includes('rate limit') || e.message?.includes('429')) {
        lastError = e; // Store rate limit error to propagate if all fail
        continue;
      }
      throw e; // Non-rate-limit or non-timeout error — propagate immediately
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error('All Groq models failed or no API key was set');
}

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

  if (!q || !q.trim()) {
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
    // Serialize and cap data to avoid token limit errors
    let dataStr = JSON.stringify(data, null, 2);
    if (dataStr.length > MAX_DATA_CHARS) {
      dataStr = dataStr.substring(0, MAX_DATA_CHARS) + '
  "...": "[data truncated]"
}';
    }

    const prompt = `You are Tillu, a data structuring assistant. Given a search query and raw data, structure it into clean, useful JSON.

Query: ${q.trim()}

Raw Data:
${dataStr}

Return a JSON object with EXACTLY this schema (omit arrays that would be empty):
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
- Respond ONLY with valid JSON — no markdown fences, no extra text
- Only include fields that have data (omit empty arrays)
- Keep key_points to 3-7 items
- Keep sources to top 5 most relevant
- Keep videos to top 5 most relevant
- Keep facts to 3-5 items
- Be accurate — only use information from the raw data`;

    const { content: rawContent, model: usedModel } = await callLLM(prompt, 2048);

    let structured;
    try {
      structured = JSON.parse(stripMarkdownJson(rawContent));
    } catch {
      structured = { answer: rawContent };
    }

    return res.status(200).json({
      success: true,
      query: q.trim(),
      structured,
      model: usedModel
    });

  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    const message = isTimeout
      ? 'Groq request timed out after 20s'
      : `Structuring failed: ${err.message}`;

    console.error('[llm-structurer] Error:', message);
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
  return str
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}