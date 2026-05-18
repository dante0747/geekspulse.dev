import { RSS2JSON, MAX_PER_FEED } from './config.js';
import { getFeeds } from './feeds-registry.js';
import { truncate, stripHtml, getText, safeUrl } from './utils.js';
import {
  normalizeImageUrl, isProbablyBadImageUrl,
  extractImageCandidatesFromHtml, extractImageCandidatesFromFeedItem,
  pickBestImageCandidate, extractImage,
} from './images.js';
import { fetchViaCorsProxy } from './http.js';

// ── rss2json session guard ────────────────────────────────────────
// If rss2json returns a rate-limit or auth error, we skip it for the
// remainder of the browser session to avoid hammering the free-tier endpoint.

let _rss2jsonBannedUntil = 0;
const RSS2JSON_RETRY_AFTER_MS = 10 * 60 * 1_000; // 10 min cool-down

function isRss2JsonAvailable() {
  return Date.now() > _rss2jsonBannedUntil;
}

function banRss2Json(reason) {
  _rss2jsonBannedUntil = Date.now() + RSS2JSON_RETRY_AFTER_MS;
  console.warn(`[GeeksPulse] rss2json suspended for ${RSS2JSON_RETRY_AFTER_MS / 60_000}m — ${reason}`);
}

// ── RSS XML parser ────────────────────────────────────────────────

export function parseRssXml(xmlText, feed) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML parse error');

  const items = [];

  doc.querySelectorAll('item').forEach(item => {
    const link = getText(item, 'link') ||
                 item.querySelector('link')?.getAttribute('href') || '#';
    const contentEncoded = getText(item, 'content\\:encoded') || '';
    const desc  = getText(item, 'description') || getText(item, 'summary') || contentEncoded;
    const date  = getText(item, 'pubDate') || getText(item, 'published') || getText(item, 'updated') || '';
    items.push({
      title:    getText(item, 'title') || 'Untitled',
      link,
      snippet:  truncate(stripHtml(desc)),
      image:    extractImage(item, desc, contentEncoded),
      date,
      source:   feed.name,
      category: feed.category,
    });
  });

  if (items.length === 0) {
    doc.querySelectorAll('entry').forEach(entry => {
      const linkEl = entry.querySelector('link[rel="alternate"]') || entry.querySelector('link');
      const link   = linkEl ? (linkEl.getAttribute('href') || linkEl.textContent.trim()) : '#';
      const contentHtml = getText(entry, 'content') || '';
      const desc   = getText(entry, 'summary') || contentHtml;
      const date   = getText(entry, 'updated') || getText(entry, 'published') || '';
      items.push({
        title:    getText(entry, 'title') || 'Untitled',
        link,
        snippet:  truncate(stripHtml(desc)),
        image:    extractImage(entry, desc, contentHtml),
        date,
        source:   feed.name,
        category: feed.category,
      });
    });
  }

  return items;
}

// ── Feed fetchers ─────────────────────────────────────────────────

async function fetchFeedDirect(feed) {
  const text = await fetchViaCorsProxy(feed.url, { timeoutMs: 10000 });
  if (!text) throw new Error('All CORS proxies failed');
  return parseRssXml(text, feed);
}

async function fetchFeedJson(feed) {
  if (!isRss2JsonAvailable()) {
    throw new Error('rss2json suspended (rate-limited this session)');
  }
  const url  = RSS2JSON + encodeURIComponent(feed.url);
  let resp;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new Error(`rss2json network error: ${e.message}`);
  }
  if (resp.status === 429) {
    banRss2Json('HTTP 429 Too Many Requests');
    throw new Error('rss2json rate limited (429)');
  }
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) banRss2Json(`HTTP ${resp.status}`);
    throw new Error(`rss2json HTTP ${resp.status}`);
  }
  const data = await resp.json();
  if (data.status !== 'ok') {
    const msg = data.message || 'rss2json error';
    // Detect free-plan quota / key errors and ban to stop hammering
    if (/rate|limit|quota|key|upgrade|forbidden/i.test(msg)) banRss2Json(msg);
    throw new Error(msg);
  }
  return (data.items || []).map(item => {
    const descHtml    = item.description || '';
    const contentHtml = item.content     || '';
    const thumb = item.thumbnail || item.enclosure?.link || null;
    const candidates = [];
    if (thumb && !isProbablyBadImageUrl(thumb)) {
      candidates.push({ url: thumb, source: 'rss-thumbnail', width: 0, height: 0, score: 20 });
    }
    for (const html of [contentHtml, descHtml].filter(Boolean)) {
      candidates.push(...extractImageCandidatesFromHtml(html, location.href));
    }
    const best = pickBestImageCandidate(candidates);
    return {
      title:    stripHtml(item.title || 'Untitled'),
      link:     item.link     || item.url || '#',
      snippet:  truncate(stripHtml(descHtml || contentHtml)),
      image:    best ? best.url : null,
      date:     item.pubDate  || item.published || '',
      source:   feed.name,
      category: feed.category,
    };
  });
}

export async function fetchFeed(feed) {
  try {
    const items = await fetchFeedDirect(feed);
    if (items.length > 0) return items;
    return await fetchFeedJson(feed);
  } catch (e) {
    console.warn(`[GeeksPulse] Direct fetch failed for ${feed.name}, trying rss2json…`, e.message);
    return await fetchFeedJson(feed);
  }
}

// ── Static cache loader ───────────────────────────────────────────

export async function loadFeedCache() {
  const resp = await fetch('/public/feed.json', { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`Cache ${resp.status}`);
  const data = await resp.json();
  if (!data.generatedAt || !Array.isArray(data.articles) || data.articles.length === 0) {
    throw new Error('Cache empty or not yet generated');
  }
  return data;
}

export function normaliseCachedArticle(a) {
  const rawImg  = a.image ? safeUrl(a.image) : null;
  const safeImg = rawImg && rawImg !== '#' ? normalizeImageUrl(rawImg, a.link) : null;
  const fallback = a.fallbackImage || null;
  return {
    title:         stripHtml(a.title || 'Untitled'),
    link:          safeUrl(a.link),
    snippet:       a.summary      || '',
    summaryType:   a.summaryType  || '',
    image:         safeImg,
    fallbackImage: fallback,
    imageType:     a.imageType || (safeImg ? 'real' : 'fallback'),
    date:          a.publishedAt || null,
    source:        a.source   || '',
    category:      a.category || 'General',
  };
}

// ── Emergency RSS fallback ────────────────────────────────────────

export async function fetchAllFromRSS() {
  const feeds = getFeeds();
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const articles = [];
  let failedCount = 0;

  results.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      articles.push(...res.value.slice(0, MAX_PER_FEED));
    } else {
      failedCount++;
      console.warn(`[GeeksPulse] ${feeds[i].name} completely failed:`, res.reason?.message);
    }
  });

  articles.sort((a, b) => {
    const da = new Date(a.date), db = new Date(b.date);
    if (isNaN(da) && isNaN(db)) return 0;
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return db - da;
  });

  return { articles, failedCount };
}

