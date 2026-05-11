/**
 * scripts/build-feed.mjs
 *
 * Fetches all enabled RSS/Atom feeds from data/feeds.json,
 * normalises articles, deduplicates, and writes:
 *   public/feed.json        — full article cache consumed by the browser
 *   public/feed-health.json — per-feed health report
 *
 * Run: node scripts/build-feed.mjs
 * Requires Node 18+ (native fetch + crypto).
 */

import fs   from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

const FEED_TIMEOUT_MS  = 10_000;
const MAX_PER_FEED     = 15;
const MAX_ARTICLES     = 300;
const USER_AGENT       = 'GeeksPulse/1.0 (+https://geekspulse.dev; feed-bot)';

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseTagValue: true,
  trimValues: true,
  processEntities: false,
  htmlEntities: false,
  stopNodes: ['*.description', '*.content', '*.content:encoded', '*.summary'],
});

// ── Utilities ──────────────────────────────────────────────────────────────

function hashId(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

function normalizeUrl(url) {
  if (!url) return null;
  try {
    // Decode HTML entities before parsing (feeds often encode & as &amp;)
    const decoded = String(url.trim())
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    const u = new URL(decoded);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(str, n = 220) {
  const s = (str || '').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function normalizeDate(raw) {
  if (!raw) return null;
  try {
    const d = new Date(String(raw).trim());
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

// ── Image extraction ───────────────────────────────────────────────────────

const BAD_URL_RE = /\b(logo|icon|favicon|avatar|sprite|pixel|tracking|badge|placeholder|spacer|1x1|blank|beacon|counter|feedburner|feedproxy|analytics|stats|doubleclick|googlesyndication|adservice|adsystem|quantserve|chartbeat|scorecardresearch|gravatar)\b/i;
const IMG_EXT    = /\.(jpe?g|png|webp|avif)(\?|$)/i;

function isBadImageUrl(url) {
  if (!url) return true;
  if (url.startsWith('data:')) return true;
  if (/\.svg(\?|$)/i.test(url)) return true;
  try {
    const u = new URL(url);
    if (BAD_URL_RE.test(u.hostname)) return true;
    if (BAD_URL_RE.test(u.pathname)) return true;
  } catch { /* keep */ }
  return false;
}

function scoreImage(url, source, w = 0, h = 0) {
  let score = 0;
  if (source === 'media:content' || source === 'media:thumbnail') score += 20;
  else if (source === 'enclosure') score += 15;
  else if (source === 'html-img')    score += 8;   // inline images in article HTML
  else if (source === 'html-srcset') score += 6;   // srcset images in article HTML
  if (IMG_EXT.test(url)) score += 10;
  if (w > 0 && h > 0) {
    score += Math.min(w * h, 800_000) / 12_000;
    const r = w / h;
    if (r < 0.5 || r > 4) score -= 8;
    if (r >= 1.2 && r <= 2.0) score += 5;
    // Penalise tiny images (likely icons/thumbnails)
    if (w < 200 || h < 100) score -= 12;
  }
  if (/\/(image|img|photo|thumb|hero|featured|cover|banner|post|article|upload|media|content)\b/i.test(url)) score += 6;
  if (isBadImageUrl(url)) score -= 30;
  return score;
}

/** Decode HTML entities in a URL string. */
function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extract <img> URLs from an HTML string using regex (no DOM available in Node). */
function extractImagesFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const results = [];

  const imgRe = /<img\b[^>]+>/gi;
  let imgMatch;
  while ((imgMatch = imgRe.exec(html)) !== null) {
    const tag = imgMatch[0];

    const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) {
      const url = normalizeUrl(decodeHtmlEntities(srcMatch[1].trim()));
      const wMatch = tag.match(/\bwidth\s*=\s*["']?(\d+)/i);
      const hMatch = tag.match(/\bheight\s*=\s*["']?(\d+)/i);
      const w = wMatch ? parseInt(wMatch[1], 10) : 0;
      const h = hMatch ? parseInt(hMatch[1], 10) : 0;
      if (url && !isBadImageUrl(url)) {
        results.push({ url, source: 'html-img', w, h });
      }
    }

    const srcsetMatch = tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i);
    if (srcsetMatch) {
      const parts = srcsetMatch[1].split(',')
        .map(p => decodeHtmlEntities(p.trim().split(/\s+/)[0]))
        .filter(Boolean);
      const best = normalizeUrl(parts[parts.length - 1]);
      if (best && !isBadImageUrl(best)) {
        results.push({ url: best, source: 'html-srcset', w: 0, h: 0 });
      }
    }
  }

  return results;
}

function extractBestImage(item) {
  const candidates = [];

  // 1. media:content / media:thumbnail (highest confidence)
  for (const key of ['media:content', 'media:thumbnail']) {
    const node = item[key];
    if (node) {
      const nodes = Array.isArray(node) ? node : [node];
      for (const n of nodes) {
        const rawUrl = n['@_url'];
        const url = normalizeUrl(decodeHtmlEntities(rawUrl || ''));
        if (url && !isBadImageUrl(url)) {
          const w = parseInt(n['@_width']  || 0, 10) || 0;
          const h = parseInt(n['@_height'] || 0, 10) || 0;
          candidates.push({ url, source: key, w, h });
        }
      }
    }
  }

  // 2. RSS enclosure
  const enc = item.enclosure;
  if (enc) {
    const encNodes = Array.isArray(enc) ? enc : [enc];
    for (const e of encNodes) {
      const t = e['@_type'] || '';
      const rawU = e['@_url']  || '';
      const u = normalizeUrl(decodeHtmlEntities(rawU)) || rawU;
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

  for (const html of htmlSources) {
    candidates.push(...extractImagesFromHtml(html));
  }

  if (!candidates.length) return null;

  const scored = candidates
    .map(c => ({ ...c, score: scoreImage(c.url, c.source, c.w, c.h) }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].url : null;
}

// ── Feed parsers ───────────────────────────────────────────────────────────

function parseRssItems(parsed, feed) {
  const channel = parsed?.rss?.channel || parsed?.channel;
  if (!channel) return [];
  const rawItems = channel.item || [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items.slice(0, MAX_PER_FEED).map(item => {
    const link = normalizeUrl(
      item.link || item.guid?.['#text'] || item.guid || ''
    );
    if (!link) return null;

    const title   = stripHtml(item.title || 'Untitled');
    const desc    = item['content:encoded'] || item.description || item.summary || '';
    const summary = truncate(stripHtml(desc));
    const date    = normalizeDate(item.pubDate || item.published || item.updated);
    const image   = extractBestImage(item);

    return { id: hashId(link), title, link, source: feed.name, sourceId: feed.id, category: feed.category, publishedAt: date, summary, image, fetchedAt: new Date().toISOString() };
  }).filter(Boolean);
}

function parseAtomEntries(parsed, feed) {
  const root  = parsed?.feed;
  if (!root) return [];
  const rawEntries = root.entry || [];
  const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

  return entries.slice(0, MAX_PER_FEED).map(entry => {
    let link = null;
    const linkNode = entry.link;
    if (linkNode) {
      const links = Array.isArray(linkNode) ? linkNode : [linkNode];
      const alt  = links.find(l => l['@_rel'] === 'alternate' || !l['@_rel']);
      link = normalizeUrl(alt?.['@_href'] || alt?.['#text'] || '');
    }
    if (!link) link = normalizeUrl(entry.id || '');
    if (!link) return null;

    const title   = stripHtml(entry.title?.['#text'] || entry.title || 'Untitled');
    const desc    = entry.content?.['#text'] || entry.content || entry.summary?.['#text'] || entry.summary || '';
    const summary = truncate(stripHtml(desc));
    const date    = normalizeDate(entry.updated || entry.published);
    const image   = extractBestImage(entry);

    return { id: hashId(link), title, link, source: feed.name, sourceId: feed.id, category: feed.category, publishedAt: date, summary, image, fetchedAt: new Date().toISOString() };
  }).filter(Boolean);
}

function parseFeedXml(xml, feed) {
  const parsed = XML_PARSER.parse(xml);
  const rssItems  = parseRssItems(parsed, feed);
  if (rssItems.length) return rssItems;
  return parseAtomEntries(parsed, feed);
}

// ── Fetch one feed ─────────────────────────────────────────────────────────

async function fetchOneFeed(feed) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const resp = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    return { feed, articles: parseFeedXml(xml, feed), ok: true };
  } catch (err) {
    return { feed, articles: [], ok: false, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const feedsPath = path.join(ROOT, 'data', 'feeds.json');
  const feedDefs  = JSON.parse(await fs.readFile(feedsPath, 'utf8'));
  const enabled   = feedDefs.filter(f => f.enabled !== false);

  console.log(`[build-feed] Fetching ${enabled.length} feeds…`);

  const results = await Promise.allSettled(enabled.map(fetchOneFeed));

  const allArticles = [];
  const health      = [];

  for (const result of results) {
    if (result.status === 'rejected') continue;
    const { feed, articles, ok, error } = result.value;
    health.push({ id: feed.id, name: feed.name, category: feed.category, ok, error: error || null, count: articles.length, fetchedAt: new Date().toISOString() });
    if (ok) allArticles.push(...articles);
    console.log(`  ${ok ? '✓' : '✗'} ${feed.name} — ${articles.length} articles${ok ? '' : ` (${error})`}`);
  }

  // Deduplicate by link
  const seen = new Set();
  const unique = allArticles.filter(a => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });

  // Sort newest-first; undated go last
  unique.sort((a, b) => {
    const da = a.publishedAt ? new Date(a.publishedAt) : null;
    const db = b.publishedAt ? new Date(b.publishedAt) : null;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });

  const articles = unique.slice(0, MAX_ARTICLES);

  const failedCount  = health.filter(h => !h.ok).length;
  const successCount = health.filter(h => h.ok).length;

  const feedJson = {
    generatedAt: new Date().toISOString(),
    feedCount: enabled.length,
    articleCount: articles.length,
    successFeeds: successCount,
    failedFeeds: failedCount,
    articles,
  };

  const healthJson = { generatedAt: new Date().toISOString(), feeds: health };

  const publicDir = path.join(ROOT, 'public');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'feed.json'),        JSON.stringify(feedJson,  null, 2), 'utf8');
  await fs.writeFile(path.join(publicDir, 'feed-health.json'), JSON.stringify(healthJson, null, 2), 'utf8');

  console.log(`\n[build-feed] Done. ${articles.length} articles from ${successCount}/${enabled.length} feeds.`);
  console.log(`  Wrote public/feed.json and public/feed-health.json`);
}

main().catch(err => { console.error('[build-feed] Fatal:', err); process.exit(1); });

