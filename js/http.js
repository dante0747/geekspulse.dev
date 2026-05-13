import { CORS_PROXIES } from './config.js';

// ── Body validation ───────────────────────────────────────────────

/** True when the response body looks like real web content (not an error JSON). */
export function looksLikeUsableBody(text) {
  if (!text || text.length < 100) return false;
  const head = text.slice(0, 600).trimStart();
  if (head.startsWith('{') || head.startsWith('[')) {
    if (
      /"error"\s*:/i.test(head) ||
      /(api[\s_-]?key|free usage|limited to localhost|not allowed|upgrade|rate ?limit|forbidden|quota|pricing)/i.test(head)
    ) {
      return false;
    }
  }
  if (/temporarily rate limited|attention required|cloudflare/i.test(head) &&
      /<title|<html/i.test(head) === false) {
    return false;
  }
  return true;
}

// ── CORS proxy chain ──────────────────────────────────────────────

/** Fetch a URL via a chain of public CORS proxies; returns response text or null. */
export async function fetchViaCorsProxy(targetUrl, { timeoutMs = 8000 } = {}) {
  for (const build of CORS_PROXIES) {
    try {
      const proxied = build(targetUrl);
      const resp = await fetch(proxied, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
      });
      if (!resp.ok) continue;
      const text = await resp.text();
      if (looksLikeUsableBody(text)) return text;
    } catch { /* try next proxy */ }
  }
  return null;
}

