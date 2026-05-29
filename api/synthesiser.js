// ──────────────────────────────────────────────
// /api/synthesiser?q=...&context=...
// Groq LLM synthesis of search context
// ──────────────────────────────────────────────

import { groqSynthesize } from './lib/llm.js';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

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
    const synthesis = await groqSynthesize(q.trim(), context);

    return res.status(200).json({
      success: true,
      query: q.trim(),
      synthesis,
      model: "auto"
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