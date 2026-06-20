const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Model fallback chain (updated June 2026 — old Llama/Mixtral models deprecated)
const LLM_MODELS = [
  'openai/gpt-oss-120b',       // Primary — replaces llama-3.3-70b-versatile
  'qwen/qwen3-32b',            // Fallback — fast and capable
  'openai/gpt-oss-20b',        // Lightweight fallback — replaces llama-3.1-8b-instant
];

const MAX_CONTEXT_CHARS = 6000;
const MAX_DATA_CHARS = 6000;

// ── Strip markdown code fences (```json ... ```) from LLM output ──
function stripMarkdownJson(str) {
  if (!str) return str;
  return str
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/**
 * Call LLM with model fallback chain
 */
export async function callLLM(prompt, maxTokens = 800) {
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
          temperature: 0.2,
          max_tokens: maxTokens
        })
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text().catch(() => '');
        // Retry on rate limit (429) or model not found (404) — try next model
        if (llmRes.status === 429 || llmRes.status === 404) {
          console.warn(`[llm] ${model} returned ${llmRes.status}, trying next model...`);
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
        lastError = e;
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error('All Groq models failed or no API key was set');
}

/**
 * Synthesize context into an answer
 */
export async function groqSynthesize(query, contextItems) {
  let contextText = '';
  if (Array.isArray(contextItems)) {
    contextText = contextItems.map((c, i) => {
      let s = `[${i + 1}] ${c.title || 'Untitled'}`;
      if (c.snippet) s += `\n${c.snippet.substring(0, 300)}`;
      if (c.content) s += `\n${c.content.substring(0, 800)}`;
      if (c.url) s += `\nSource: ${c.url}`;
      return s;
    }).join('\n\n');
  } else if (typeof contextItems === 'string') {
    contextText = contextItems;
  }

  if (!contextText.trim()) {
    contextText = 'No context available.';
  }

  if (contextText.length > MAX_CONTEXT_CHARS) {
    contextText = contextText.substring(0, MAX_CONTEXT_CHARS) + '\n[...context truncated...]';
  }

const prompt = `You are Tillu, an intelligent search assistant. Given the following search results and web content, provide a comprehensive synthesis that answers the user's query.

RULES:
- Synthesize the WHOLE results based on the user's query rather than just summarizing.
- Evaluate the reliability of the sources and assign a confidence_score (0-100).
- Embed links to sources and YouTube videos directly in the answer text using markdown [Source Name](url).
- Be accurate and cite specific facts from the sources.
- Filter out duplicate search results or redundant information.
- If sources conflict, mention it.
- If context is insufficient, say so honestly and lower the confidence_score.
- Respond ONLY with valid JSON — no markdown fences, no extra text.

Query: ${query.trim()}

Context:
${contextText}

Return this JSON object:
{
  "answer": "your comprehensive synthesized answer here, with embedded links",
  "confidence_score": 95,
  "key_points": ["point 1", "point 2", "point 3"],
  "facts": ["specific fact 1", "specific fact 2"]
}`;

  const { content: rawContent } = await callLLM(prompt, 800);
  let synthesis;
  try {
    synthesis = JSON.parse(stripMarkdownJson(rawContent));
  } catch {
    synthesis = { answer: rawContent, key_points: [], facts: [] };
  }

  synthesis.key_points = Array.isArray(synthesis.key_points) ? synthesis.key_points : [];
  synthesis.facts = Array.isArray(synthesis.facts) ? synthesis.facts : [];
  return synthesis;
}

/**
 * Structure synthesis and raw data into consistent JSON schema
 */
export async function groqStructure(query, data) {
  let dataStr = JSON.stringify(data, null, 2);
  if (dataStr.length > MAX_DATA_CHARS) {
    dataStr = dataStr.substring(0, MAX_DATA_CHARS) + '\n  "...": "[data truncated]"\n}';
  }

  const prompt = `You are Tillu, a data structuring assistant. Given a search query and raw data, structure it into clean, useful JSON. Filter out duplicated sources or redundant videos.

Query: ${query.trim()}

Raw Data:
${dataStr}

Return a JSON object with EXACTLY this schema (omit arrays that would be empty):
{
  "answer": "a comprehensive answer synthesizing the whole results, embedding source and video links directly using markdown [Name](url)",
  "confidence_score": 95,
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
- Ensure the 'answer' retains the embedded source and YouTube links from the synthesis.
- Ensure the 'confidence_score' is an integer between 0 and 100 based on data reliability.
- Respond ONLY with valid JSON — no markdown fences, no extra text
- Only include fields that have data (omit empty arrays)
- Keep key_points to 3-7 items
- Keep sources to top 5 most relevant unique sources
- Keep videos to top 5 most relevant unique videos
- Keep facts to 3-5 items
- Be accurate — only use information from the raw data`;

  const { content: rawContent } = await callLLM(prompt, 2048);
  let structured;
  try {
    structured = JSON.parse(stripMarkdownJson(rawContent));
  } catch {
    structured = { answer: rawContent };
  }
  return structured;
}
