/**
 * scripts/lib/images.mjs
 * Image extraction from RSS feed XML and article page og:image resolution.
 */

import {
  BAD_PATH_PATTERNS, BAD_HOSTNAME_RE, TINY_SIZE_RE, BAD_URL_RE, IMG_EXT,
  IMAGE_HEAD_MAX_BYTES, ARTICLE_TIMEOUT_MS,
} from './config.mjs';
import { normalizeUrl, absUrl, decodeHtmlEntities, streamHtml } from './utils.mjs';

// ── Image URL validation ───────────────────────────────────────────────────

export function isBadImageUrl(url) {
  if (!url) return true;
  if (url.startsWith('data:')) return true;
  if (/\.svg(\?|$)/i.test(url)) return true;
  if (TINY_SIZE_RE.test(url)) return true;
  if (BAD_URL_RE.test(url)) return true;
  try {
    const u = new URL(url);
    if (BAD_HOSTNAME_RE.test(u.hostname)) return true;
    // Split path into segments and check each segment against known bad tokens
    const pathLower = u.pathname.toLowerCase();
    const segments  = pathLower.split(/[/\-_.]+/).filter(Boolean);
    if (segments.some(seg => BAD_PATH_PATTERNS.includes(seg))) return true;
    // Also check for patterns as substrings (catches compound names like "rss-32px")
    if (BAD_PATH_PATTERNS.some(p => pathLower.includes('/' + p + '/') || pathLower.endsWith('/' + p))) return true;
  } catch { /* keep */ }
  return false;
}

// ── Image scoring ─────────────────────────────────────────────────────────

export function scoreImage(url, source, w = 0, h = 0) {
  let score = 0;
  if (source === 'media:content' || source === 'media:thumbnail') score += 20;
  else if (source === 'enclosure')   score += 15;
  else if (source === 'html-img')    score += 8;  // inline images in article HTML
  else if (source === 'html-srcset') score += 6;  // srcset images in article HTML
  if (IMG_EXT.test(url)) score += 10;
  if (w > 0 && h > 0) {
    score += Math.min(w * h, 800_000) / 12_000;
    const r = w / h;
    if (r < 0.5 || r > 4)     score -= 8;
    if (r >= 1.2 && r <= 2.0) score += 5;
    if (w < 200 || h < 100)   score -= 12; // penalise tiny images (likely icons/thumbnails)
  }
  if (/\/(image|img|photo|thumb|hero|featured|cover|banner|post|article|upload|media|content)\b/i.test(url)) score += 6;
  if (isBadImageUrl(url)) score -= 30;
  return score;
}

// ── HTML image extraction ─────────────────────────────────────────────────

/** Extract <img> URLs from an HTML string using regex (no DOM available in Node). */
export function extractImagesFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const results = [];
  const imgRe   = /<img\b[^>]+>/gi;
  let imgMatch;

  while ((imgMatch = imgRe.exec(html)) !== null) {
    const tag = imgMatch[0];

    const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) {
      const url    = normalizeUrl(decodeHtmlEntities(srcMatch[1].trim()));
      const wMatch = tag.match(/\bwidth\s*=\s*["']?(\d+)/i);
      const hMatch = tag.match(/\bheight\s*=\s*["']?(\d+)/i);
      const w = wMatch ? parseInt(wMatch[1], 10) : 0;
      const h = hMatch ? parseInt(hMatch[1], 10) : 0;
      if (url && !isBadImageUrl(url)) results.push({ url, source: 'html-img', w, h });
    }

    const srcsetMatch = tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i);
    if (srcsetMatch) {
      const parts = srcsetMatch[1].split(',')
        .map(p => decodeHtmlEntities(p.trim().split(/\s+/)[0]))
        .filter(Boolean);
      const best = normalizeUrl(parts[parts.length - 1]);
      if (best && !isBadImageUrl(best)) results.push({ url: best, source: 'html-srcset', w: 0, h: 0 });
    }
  }

  return results;
}

// ── RSS feed image extraction ──────────────────────────────────────────────

export function extractBestImage(item) {
  const candidates = [];

  // 1. media:content / media:thumbnail (highest confidence)
  for (const key of ['media:content', 'media:thumbnail']) {
    const node = item[key];
    if (!node) continue;
    for (const n of (Array.isArray(node) ? node : [node])) {
      const url = normalizeUrl(decodeHtmlEntities(n['@_url'] || ''));
      if (!url || isBadImageUrl(url)) continue;
      const w = parseInt(n['@_width']  || 0, 10) || 0;
      const h = parseInt(n['@_height'] || 0, 10) || 0;
      candidates.push({ url, source: key, w, h });
    }
  }

  // 2. RSS enclosure
  if (item.enclosure) {
    for (const e of (Array.isArray(item.enclosure) ? item.enclosure : [item.enclosure])) {
      const t = e['@_type'] || '';
      const u = normalizeUrl(decodeHtmlEntities(e['@_url'] || '')) || e['@_url'] || '';
      if ((t.startsWith('image/') || IMG_EXT.test(u)) && !isBadImageUrl(u)) {
        candidates.push({ url: u, source: 'enclosure', w: 0, h: 0 });
      }
    }
  }

  // 3. Mine HTML payloads: content:encoded first (richer), then description/summary
  const htmlSources = [
    item['content:encoded'],
    item.content?.['#text'] || item.content,
    item.description,
    item.summary?.['#text'] || item.summary,
  ].filter(s => s && typeof s === 'string');

  for (const html of htmlSources) candidates.push(...extractImagesFromHtml(html));

  if (!candidates.length) return null;
  const scored = candidates
    .map(c => ({ ...c, score: scoreImage(c.url, c.source, c.w, c.h) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].url : null;
}

// ── Article-page og:image resolver (Node-side; no CORS limits) ────────────

/** Extract the first matching <meta>/<link> attribute from raw HTML. */
function extractMetaUrl(html, attr, valueRe) {
  if (!html) return null;
  // Match e.g. <meta property="og:image" content="..."> in any attribute order
  const re = new RegExp(
    `<(?:meta|link)\\b[^>]*\\b${attr}\\s*=\\s*["']${valueRe.source}["'][^>]*>`, 'i'
  );
  const m = html.match(re);
  if (!m) return null;
  // Pull content="..." or href="..." from the matched tag
  const c = m[0].match(/\b(?:content|href)\s*=\s*["']([^"']+)["']/i);
  return c ? decodeHtmlEntities(c[1]) : null;
}

/** Fetch an article page and extract og:image / twitter:image / first body <img>. */
export async function fetchArticleImage(articleUrl) {
  // Stop reading after </head> — we only need meta tags, not the full body
  const html = await streamHtml(articleUrl, IMAGE_HEAD_MAX_BYTES, ARTICLE_TIMEOUT_MS, /<\/head>/i);
  if (!html) return null;

  // Try OG / Twitter / image_src in priority order
  const metaCandidates = [
    extractMetaUrl(html, 'property', /og:image:secure_url/),
    extractMetaUrl(html, 'property', /og:image:url/),
    extractMetaUrl(html, 'property', /og:image/),
    extractMetaUrl(html, 'name',     /twitter:image:src/),
    extractMetaUrl(html, 'name',     /twitter:image/),
    extractMetaUrl(html, 'rel',      /image_src/),
  ];
  for (const raw of metaCandidates) {
    if (!raw) continue;
    const u = normalizeUrl(absUrl(raw, articleUrl));
    if (u && !isBadImageUrl(u)) return u;
  }

  // Fallback: first decent <img> in <body>
  const bodyHtml = (html.match(/<body\b[\s\S]*$/i) || [html])[0];
  for (const c of extractImagesFromHtml(bodyHtml)) {
    const u = normalizeUrl(absUrl(c.url, articleUrl));
    if (!u || isBadImageUrl(u)) continue;
    if ((c.w && c.w < 200) || (c.h && c.h < 100)) continue; // skip tiny images
    return u;
  }

  return null;
}

