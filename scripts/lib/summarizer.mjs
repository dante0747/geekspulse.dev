/**
 * scripts/lib/summarizer.mjs
 * LLM-powered article summarization (Ollama only).
 * Falls back gracefully to the existing RSS snippet when Ollama is unavailable.
 */

import { OLLAMA_MODEL, MIN_SUMMARY_LEN, ARTICLE_TEXT_MAX_BYTES, ARTICLE_TEXT_MAX_CHARS, ARTICLE_TIMEOUT_MS } from './config.mjs';
import { ollamaClient, aiCache } from './ai.mjs';
import { streamHtml }            from './utils.mjs';

// ── Article text fetcher ───────────────────────────────────────────────────

/** Fetch an article page and return plain-text body content (best-effort). */
async function fetchArticleText(articleUrl) {
  const html = await streamHtml(articleUrl, ARTICLE_TEXT_MAX_BYTES, ARTICLE_TIMEOUT_MS);
  if (!html) return null;

  // Extract <body> if present, otherwise use the full HTML
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml  = bodyMatch ? bodyMatch[1] : html;

  // Strip scripts, styles, nav, footer, aside, then all tags → plain text
  const text = bodyHtml
    .replace(/<(script|style|nav|footer|aside|header)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/\s+/g, ' ')
    .trim();

  return text.slice(0, ARTICLE_TEXT_MAX_CHARS) || null;
}

// ── Summarizer ────────────────────────────────────────────────────────────

export async function summarizeArticle(title = '', existingSummary = '', articleUrl = '') {
  if (!ollamaClient) return existingSummary;
  if (existingSummary.length >= MIN_SUMMARY_LEN) return existingSummary;

  const cacheKey = `summary::${title.slice(0, 120)}`;
  if (aiCache[cacheKey]) return aiCache[cacheKey];

  try {
    // Try to fetch the full article text; fall back to the RSS snippet
    let bodyText = articleUrl ? await fetchArticleText(articleUrl) : null;
    if (!bodyText && existingSummary) bodyText = existingSummary;

    const articleText = bodyText
      ? `Title: ${title}\n\nArticle content:\n${bodyText}`
      : `Title: ${title}`;

    const prompt =
      `You are a technical news editor writing for a developer audience.\n` +
      `Write a concise summary (2-4 sentences, max 80 words) of the article below.\n` +
      `Focus on: the core topic, the key technology or finding, and why it matters to developers.\n` +
      `Rules:\n` +
      `- Plain prose only. No markdown, no headers, no bullet points, no numbered lists, no bold, no italics.\n` +
      `- Do NOT start with "This article", "The article", or a restatement of the title.\n` +
      `- Do NOT include section labels like "Summary:", "Key Technology:", "Why it matters:", etc.\n` +
      `- Output only the summary paragraph — nothing else.\n\n` +
      `${articleText}`;

    const resp = await ollamaClient.generate({
      model: OLLAMA_MODEL, prompt, stream: false,
      options: { temperature: 0.3, num_predict: 200 },
    });
    let summary = (resp.response || '').trim().replace(/^["']|["']$/g, '');

    // Reject summaries that violate the prompt instructions
    if (/^(this article|the article)\b/i.test(summary)) {
      console.warn(`[classifier] summary starts with forbidden phrase for "${title.slice(0, 50)}", discarding`);
      return existingSummary;
    }

    // Reject summaries with markdown formatting (headers, bold, bullets, numbered lists)
    if (
      /#{1,6} /.test(summary)          ||
      /\*\*[^*]+\*\*/.test(summary)    ||
      /^\s*[-*+] /m.test(summary)      ||
      /^\s*\d+\. /m.test(summary)      ||
      /^(Summary|Title|Key Technology|Why it matters)[:\s]/im.test(summary)
    ) {
      console.warn(`[classifier] summary contains markdown/labels for "${title.slice(0, 50)}", discarding`);
      return existingSummary;
    }

    // If truncated mid-sentence (no sentence-ending punctuation at end), trim to last complete sentence
    if (summary.length > 10 && !/[.!?…]$/.test(summary)) {
      const lastSentence = summary.match(/^([\s\S]*[.!?…])\s/);
      if (lastSentence) {
        summary = lastSentence[1].trim();
      } else {
        // No complete sentence found — discard to avoid publishing a cut-off snippet
        console.warn(`[classifier] summary truncated with no complete sentence for "${title.slice(0, 50)}", discarding`);
        return existingSummary;
      }
    }

    if (summary.length > 10) {
      aiCache[cacheKey] = summary;
      return summary;
    }
  } catch (e) {
    console.warn(`[classifier] summarize failed for "${title.slice(0, 50)}": ${e.message}`);
  }
  return existingSummary;
}

