// ──────────────────────────────────────────────
// /api/llm-structurer?q=...&data=...
// Structures raw data into clean JSON via Groq
// ──────────────────────────────────────────────

import { groqStructure } from './lib/llm.js';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

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
    const structured = await groqStructure(q.trim(), data);

    return res.status(200).json({
      success: true,
      query: q.trim(),
      structured,
      model: "auto"
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