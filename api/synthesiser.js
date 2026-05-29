// ──────────────────────────────────────────────
// /api/synthesiser?q=...&context=...
// Groq LLM synthesis of search context
// ──────────────────────────────────────────────

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Model fallback chain — tries fastest first, falls back on 429
const LLM_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'gpt-oss-20b',
];

const MAX_CONTEXT_CHARS = 6000;  // reduced from 12000 to stay under TPM

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
          temperature: 0.3,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' }
        })
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text().catch(() => '');
        if (llmRes.status === 429) {
          console.warn(`[synthesiser] ${model} rate limited, trying next model...`);
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
        if (c.snippet) s += `
    ${c.snippet.substring(0, 300)}`;
        if (c.content) s += `
    ${c.content.substring(0, 800)}`;
        if (c.url) s += `
    Source: ${c.url}`;
        return s;
      }).join('

');
    } else if (typeof context === 'string') {
      contextText = context;
    }

    if (!contextText.trim()) {
      contextText = 'No context available.';
    }

    // Hard cap to avoid token limit errors
    if (contextText.length > MAX_CONTEXT_CHARS) {
      contextText = contextText.substring(0, MAX_CONTEXT_CHARS) + '
[...context truncated...]';
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

    const { content: rawContent, model: usedModel } = await callLLM(prompt, 800);

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
      ? 'LLM request timed out after 20s'
      : `Synthesis failed: ${err.message}`;

    console.error('[synthesiser] Error:', message);
    return res.status(502).json({
      success: false,
      error: message,
      query: q.trim()
    });
  }
}

// ────────────────────────────────────────────────────────
// Helper: Groq Synthesis
// ────────────────────────────────────────────────────────

// ── Strip markdown code fences (```json ... ```) from LLM output ──
function stripMarkdownJson(str) {
  if (!str) return str;
  // Remove leading/trailing ``` or ```json fences
  return str
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}