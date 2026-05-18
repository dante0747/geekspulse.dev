/**
 * scripts/lib/parser.mjs
 * RSS/Atom feed parsing and fetching.
 */

import { XML_PARSER, MAX_PER_FEED, FEED_TIMEOUT_MS, USER_AGENT } from './config.mjs';
import { hashId, normalizeUrl, stripHtml, isLowValueSnippet, truncate, normalizeDate, getFallbackImage } from './utils.mjs';
import { extractBestImage } from './images.mjs';

// ── Article record builder ─────────────────────────────────────────────────

/** Build a normalised article record — single source of truth for the shape. */
export function buildArticleRecord(feed, { link, title, summary, date, image }) {
  return {
    id:            hashId(link),
    title,
    link,
    source:        feed.name,
    sourceId:      feed.id,
    category:      feed.category,
    publishedAt:   date,
    summary,
    summaryType:   summary ? 'snippet' : '',
    image,
    fallbackImage: getFallbackImage(feed.category),
    imageType:     image ? 'real' : 'fallback',
    fetchedAt:     new Date().toISOString(),
  };
}

// ── Feed parsers ───────────────────────────────────────────────────────────

export function parseRssItems(parsed, feed) {
  const channel  = parsed?.rss?.channel || parsed?.channel;
  if (!channel) return [];
  const rawItems = channel.item || [];
  const items    = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items.slice(0, MAX_PER_FEED).map(item => {
    const link = normalizeUrl(item.link || item.guid?.['#text'] || item.guid || '');
    if (!link) return null;
    const title      = stripHtml(item.title || 'Untitled');
    const desc       = item['content:encoded'] || item.description || item.summary || '';
    const rawSnippet = truncate(stripHtml(desc));
    const summary    = isLowValueSnippet(rawSnippet) ? '' : rawSnippet;
    const date       = normalizeDate(item.pubDate || item.published || item.updated);
    const image      = extractBestImage(item);
    return buildArticleRecord(feed, { link, title, summary, date, image });
  }).filter(Boolean);
}

export function parseAtomEntries(parsed, feed) {
  const root = parsed?.feed;
  if (!root) return [];
  const rawEntries = root.entry || [];
  const entries    = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

  return entries.slice(0, MAX_PER_FEED).map(entry => {
    let link = null;
    const linkNode = entry.link;
    if (linkNode) {
      const links = Array.isArray(linkNode) ? linkNode : [linkNode];
      const alt   = links.find(l => l['@_rel'] === 'alternate' || !l['@_rel']);
      link = normalizeUrl(alt?.['@_href'] || alt?.['#text'] || '');
    }
    if (!link) link = normalizeUrl(entry.id || '');
    if (!link) return null;
    const title      = stripHtml(entry.title?.['#text'] || entry.title || 'Untitled');
    const desc       = entry.content?.['#text'] || entry.content || entry.summary?.['#text'] || entry.summary || '';
    const rawSnippet = truncate(stripHtml(desc));
    const summary    = isLowValueSnippet(rawSnippet) ? '' : rawSnippet;
    const date       = normalizeDate(entry.updated || entry.published);
    const image      = extractBestImage(entry);
    return buildArticleRecord(feed, { link, title, summary, date, image });
  }).filter(Boolean);
}

export function parseFeedXml(xml, feed) {
  const parsed   = XML_PARSER.parse(xml);
  const rssItems = parseRssItems(parsed, feed);
  return rssItems.length ? rssItems : parseAtomEntries(parsed, feed);
}

// ── Feed fetcher ───────────────────────────────────────────────────────────

export async function fetchOneFeed(feed) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const resp = await fetch(feed.url, {
      signal:  controller.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return { feed, articles: parseFeedXml(await resp.text(), feed), ok: true };
  } catch (err) {
    return { feed, articles: [], ok: false, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

