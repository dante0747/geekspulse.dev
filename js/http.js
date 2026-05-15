import { CORS_PROXIES } from './config.js';

// ── In-session proxy health cache ─────────────────────────────────
// Tracks which proxy indices failed this session so they are deprioritised.
// Reset if the tab is closed; no persistent storage needed.
const _proxyFailedAt = new Map(); // index → timestamp ms
const PROXY_COOLDOWN_MS = 5 * 60 * 1000; // 5 min before retrying a failed proxy

function isProxyCoolingDown(idx) {
  const t = _proxyFailedAt.get(idx);
  if (!t) return false;
  if (Date.now() - t < PROXY_COOLDOWN_MS) return true;
  _proxyFailedAt.delete(idx); // cooldown expired, allow retry
  return false;
}

function markProxyFailed(idx) {
  _proxyFailedAt.set(idx, Date.now());
  console.debug(`[GeeksPulse] CORS proxy #${idx} marked as failed (cooldown ${PROXY_COOLDOWN_MS / 60000}m)`);
}

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
  // First pass: try proxies not currently cooling down
  // Second pass: try all proxies (including cooled-down ones) if first pass exhausted
  for (const pass of [false, true]) {
    for (let idx = 0; idx < CORS_PROXIES.length; idx++) {
      if (!pass && isProxyCoolingDown(idx)) continue;
      if (pass  && !isProxyCoolingDown(idx)) continue; // already tried in pass 0
      try {
        const proxied = CORS_PROXIES[idx](targetUrl);
        const resp = await fetch(proxied, {
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'follow',
          referrerPolicy: 'no-referrer',
        });
        if (!resp.ok) { markProxyFailed(idx); continue; }
        const text = await resp.text();
        if (looksLikeUsableBody(text)) return text;
        markProxyFailed(idx);
      } catch {
        markProxyFailed(idx);
      }
    }
  }
  return null;
}
