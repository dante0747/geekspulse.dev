/**
 * scripts/lib/sponsored.mjs
 * Sponsored / promotional content detection.
 * Tier 1: fast regex. Tier 2: Ollama LLM for subtle cases.
 */

import { SPONSORED_RE, OLLAMA_MODEL } from './config.mjs';
import { ollamaClient, aiCache }       from './ai.mjs';

// ── Tier 1: regex (always runs — catches obvious cases instantly) ──────────

export function regexDetectSponsored(title = '', summary = '') {
  return SPONSORED_RE.test(`${title} ${summary}`);
}

// ── Tier 2: LLM (only when Ollama is running) ─────────────────────────────

export async function detectSponsored(title = '', summary = '') {
  // Fast path: regex catches it — no LLM call needed
  if (regexDetectSponsored(title, summary)) return true;
  // No Ollama → rely only on regex
  if (!ollamaClient) return false;

  const cacheKey = `sponsored::${title.slice(0, 120)}`;
  if (cacheKey in aiCache) return aiCache[cacheKey] === 'yes';

  try {
    const prompt =
      `You are a spam/noise classifier for a developer news aggregator.\n` +
      `Decide if the article below is sponsored, promotional, or marketing content.\n\n` +
      `Examples of sponsored/promotional content:\n` +
      `- "Join our upcoming webinar on cloud security"\n` +
      `- "Company X launches new product Y — try it free"\n` +
      `- "Brought to you by Acme Corp"\n` +
      `- "How [Vendor] helped [Company] reduce costs by 40%"\n` +
      `- "[Product] is now available — sign up today"\n\n` +
      `Examples of genuine developer news:\n` +
      `- "CVE-2025-1234: Remote code execution in OpenSSH"\n` +
      `- "Python 3.14 released with new features"\n` +
      `- "How GitHub Actions handles secrets in fork PRs"\n\n` +
      `Rules:\n` +
      `- Reply with ONLY the word "yes" (sponsored) or "no" (genuine).\n` +
      `- When in doubt, answer "no".\n\n` +
      `Title: ${title}\nSnippet: ${summary.slice(0, 300)}\n\nAnswer:`;
    const resp        = await ollamaClient.generate({
      model: OLLAMA_MODEL, prompt, stream: false,
      options: { temperature: 0, num_predict: 5 },
    });
    const answer      = (resp.response || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    const isSponsored = answer.startsWith('yes');
    aiCache[cacheKey] = isSponsored ? 'yes' : 'no';
    return isSponsored;
  } catch (e) {
    console.warn(`[classifier] sponsored detection failed for "${title.slice(0, 50)}": ${e.message}`);
    return false;
  }
}

