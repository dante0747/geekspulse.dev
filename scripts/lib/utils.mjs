/**
 * scripts/lib/utils.mjs
 * Pure utility helpers and the shared HTTP streaming function.
 */

import { createHash } from 'node:crypto';
import {
  CATEGORY_FALLBACK_IMAGES,
  USER_AGENT,
} from './config.mjs';

// ── Category helpers ───────────────────────────────────────────────────────

export function getFallbackImage(category) {
  return CATEGORY_FALLBACK_IMAGES[category] || CATEGORY_FALLBACK_IMAGES['General'];
}

// ── String / URL helpers ───────────────────────────────────────────────────

export function hashId(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

export function normalizeUrl(url) {
  if (!url) return null;
  try {
    // Decode HTML entities before parsing (feeds often encode & as &amp;)
    const decoded = String(url.trim())
      .replace(/&amp;/g,  '&')
      .replace(/&lt;/g,   '<')
      .replace(/&gt;/g,   '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g,  "'");
    const u = new URL(decoded);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** Resolve a relative URL against a base; return null on failure. */
export function absUrl(url, base) {
  if (!url) return null;
  try { return new URL(url, base).href; } catch { return null; }
}

export function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'");
}

export function stripHtml(html) {
  if (!html) return '';
  // Step 1: handle objects from the XML parser (e.g. { '#text': '...', '@_type': 'html' })
  let s = typeof html === 'object' && html !== null
    ? (html['#text'] || html['#cdata-section'] || '')
    : String(html);
  // Step 2: strip CDATA wrappers
  s = s.replace(/<!\[CDATA\[|\]\]>/g, '');
  // Step 3: decode HTML entities BEFORE stripping tags (some feeds entity-encode their HTML)
  s = s
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&amp;/g,  '&');
  // Step 4: strip script/style blocks, then img, figure, figcaption, then all remaining tags
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<figure[\s\S]*?<\/figure>/gi, '')
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  // Step 5: clean up whitespace and low-value trailing noise
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/\bComments\b\s*$/i, '')
    .replace(/\bRead more\b\.?\s*$/i, '')
    .replace(/\bContinue reading\b\.?\s*$/i, '')
    .replace(/\bView article\b\.?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLowValueSnippet(value = '') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    !normalized                       ||
    normalized === 'comments'         ||
    normalized === 'read more'        ||
    normalized === 'continue reading' ||
    normalized === 'view article'     ||
    normalized === 'learn more'
  );
}

export function truncate(str, n = 220) {
  const s = (str || '').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function normalizeDate(raw) {
  if (!raw) return null;
  try {
    const d = new Date(String(raw).trim());
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/** Comparator: sorts articles newest-first; undated entries go last. */
export function newestFirst(a, b) {
  const da = a.publishedAt ? new Date(a.publishedAt) : null;
  const db = b.publishedAt ? new Date(b.publishedAt) : null;
  if (!da && !db) return  0;
  if (!da)        return  1;
  if (!db)        return -1;
  return db - da;
}

/** Run an async worker over `items` with bounded concurrency. */
export async function runLimited(items, limit, worker) {
  const queue   = items.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(workers);
}

// ── HTTP ───────────────────────────────────────────────────────────────────

/**
 * Stream-read a URL's HTML response body up to `maxBytes`.
 * Stops early if `stopRe` matches the accumulated text (e.g. `/<\/head>/i`).
 * Returns the accumulated HTML string, or null on any error.
 */
export async function streamHtml(url, maxBytes, timeoutMs, stopRe = null) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal:   controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!resp.ok) return null;

    const reader = resp.body?.getReader?.();
    if (!reader) return (await resp.text()) || null;

    const decoder = new TextDecoder('utf-8');
    let html  = '';
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      html  += decoder.decode(value, { stream: true });
      if (bytes >= maxBytes || (stopRe && stopRe.test(html))) {
        try { reader.cancel(); } catch { /* ignore */ }
        break;
      }
    }
    html += decoder.decode();
    return html || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

